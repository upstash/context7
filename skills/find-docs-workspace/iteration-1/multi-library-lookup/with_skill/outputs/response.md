# Setting Up Next.js 15 Server Actions with Drizzle ORM Transactions for Postgres

This guide covers how to wire up Next.js 15 Server Actions to write data to a Postgres database using Drizzle ORM's transaction API. The approach uses:

- **Next.js 15 Server Actions** (`'use server'` directive) to handle mutations from the client
- **Drizzle ORM** with `node-postgres` for type-safe Postgres access
- **Drizzle's `db.transaction()` API** to group multiple writes into atomic operations

## 1. Install Dependencies

```bash
npm install drizzle-orm pg
npm install -D drizzle-kit @types/pg
```

## 2. Set Up the Drizzle Database Client

Create a shared database instance that can be imported across your server-side code.

```typescript
// src/db/index.ts
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle({ client: pool, schema });
```

You can also use the simpler connection-string form if you do not need custom pool settings:

```typescript
import { drizzle } from 'drizzle-orm/node-postgres';

const db = drizzle(process.env.DATABASE_URL);
```

## 3. Define Your Schema

```typescript
// src/db/schema.ts
import { pgTable, serial, text, integer, timestamp } from 'drizzle-orm/pg-core';

export const orders = pgTable('orders', {
  id: serial('id').primaryKey(),
  userId: integer('user_id').notNull(),
  status: text('status').notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const orderItems = pgTable('order_items', {
  id: serial('id').primaryKey(),
  orderId: integer('order_id').notNull(),
  productName: text('product_name').notNull(),
  quantity: integer('quantity').notNull(),
  price: integer('price').notNull(), // stored in cents
});

export const inventory = pgTable('inventory', {
  id: serial('id').primaryKey(),
  productName: text('product_name').notNull(),
  stock: integer('stock').notNull(),
});
```

## 4. Create a Server Action with a Drizzle Transaction

Server Actions are async functions marked with `'use server'`. Place them in a dedicated file or inline them in a Server Component.

```typescript
// src/app/actions/create-order.ts
'use server'

import { db } from '@/db';
import { orders, orderItems, inventory } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

type OrderItem = {
  productName: string;
  quantity: number;
  price: number;
};

export async function createOrder(formData: FormData) {
  const userId = Number(formData.get('userId'));
  const items: OrderItem[] = JSON.parse(formData.get('items') as string);

  // db.transaction() groups all operations atomically.
  // If any step fails or you call tx.rollback(), everything is rolled back.
  const newOrder = await db.transaction(async (tx) => {
    // 1. Verify stock for every item
    for (const item of items) {
      const [stock] = await tx
        .select({ stock: inventory.stock })
        .from(inventory)
        .where(eq(inventory.productName, item.productName));

      if (!stock || stock.stock < item.quantity) {
        // Rolling back throws an exception that aborts the entire transaction
        tx.rollback();
        return; // TypeScript needs this, but it never executes after rollback
      }
    }

    // 2. Create the order
    const [order] = await tx
      .insert(orders)
      .values({ userId, status: 'confirmed' })
      .returning();

    // 3. Insert order items
    await tx.insert(orderItems).values(
      items.map((item) => ({
        orderId: order.id,
        productName: item.productName,
        quantity: item.quantity,
        price: item.price,
      }))
    );

    // 4. Decrement inventory
    for (const item of items) {
      await tx
        .update(inventory)
        .set({ stock: sql`${inventory.stock} - ${item.quantity}` })
        .where(eq(inventory.productName, item.productName));
    }

    return order;
  });

  // Revalidate the relevant path so the UI reflects the new data
  revalidatePath('/orders');

  return newOrder;
}
```

### Key points about `db.transaction()`:

- The callback receives a transaction object (`tx`) that exposes the same query API as `db`.
- Use `tx` (not `db`) for all queries inside the callback so they run within the transaction.
- Call `tx.rollback()` to abort; it throws an exception that rolls back all changes.
- The transaction returns whatever value you return from the callback.
- Drizzle supports **nested transactions** (savepoints) by calling `tx.transaction()` inside the callback:

```typescript
await db.transaction(async (tx) => {
  await tx.insert(orders).values({ userId: 1, status: 'pending' });

  // Nested transaction creates a savepoint
  await tx.transaction(async (tx2) => {
    await tx2.insert(orderItems).values({ orderId: 1, productName: 'Widget', quantity: 1, price: 999 });
  });
});
```

- For Postgres, you can set isolation levels:

```typescript
await db.transaction(async (tx) => {
  // ... your operations
}, {
  isolationLevel: 'serializable',
  accessMode: 'read write',
});
```

## 5. Build the Form Component

Invoke the Server Action from a form using the `action` prop.

```tsx
// src/app/orders/new/page.tsx
import { createOrder } from '@/app/actions/create-order';

export default function NewOrderPage() {
  return (
    <form action={createOrder}>
      <input type="hidden" name="userId" value="1" />
      <input
        type="hidden"
        name="items"
        value={JSON.stringify([
          { productName: 'Widget', quantity: 2, price: 1999 },
          { productName: 'Gadget', quantity: 1, price: 4999 },
        ])}
      />
      <button type="submit">Place Order</button>
    </form>
  );
}
```

For a more interactive form, use `useActionState` in a Client Component:

```tsx
'use client'

import { useActionState } from 'react';
import { createOrder } from '@/app/actions/create-order';

export function OrderForm() {
  const [state, formAction, isPending] = useActionState(createOrder, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="userId" value="1" />
      <input
        type="hidden"
        name="items"
        value={JSON.stringify([
          { productName: 'Widget', quantity: 2, price: 1999 },
        ])}
      />
      <button type="submit" disabled={isPending}>
        {isPending ? 'Placing order...' : 'Place Order'}
      </button>
      {state && <p>Order #{state.id} created.</p>}
    </form>
  );
}
```

## 6. Summary

| Concern | Solution |
|---|---|
| Server-side mutation | Next.js Server Action with `'use server'` directive |
| Database access | Drizzle ORM with `node-postgres` driver |
| Atomic multi-table writes | `db.transaction(async (tx) => { ... })` |
| Conditional abort | `tx.rollback()` inside the transaction callback |
| Nested transactions | `tx.transaction()` creates a savepoint |
| Isolation level | Pass `{ isolationLevel: 'serializable' }` as second arg |
| Cache invalidation | `revalidatePath()` or `revalidateTag()` after the mutation |
