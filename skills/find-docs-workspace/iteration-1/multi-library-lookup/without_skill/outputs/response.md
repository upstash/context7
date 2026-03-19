# Setting Up Server Actions with Drizzle ORM Transactions in Next.js 15

## 1. Install Dependencies

```bash
npm install drizzle-orm postgres
npm install -D drizzle-kit
```

Here, `postgres` is the PostgreSQL driver (pg.js). You can also use `@neondatabase/serverless` or `node-postgres` (`pg`) depending on your hosting environment.

## 2. Define Your Drizzle Schema

Create a schema file, for example `src/db/schema.ts`:

```ts
import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id)
    .notNull(),
  product: text("product").notNull(),
  quantity: integer("quantity").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

## 3. Set Up the Database Connection

Create `src/db/index.ts`:

```ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL!;

// For query purposes -- single connection is fine for serverless
const client = postgres(connectionString);

export const db = drizzle(client, { schema });
```

> **Note for serverless environments (Vercel, etc.):** If you are deploying to a serverless platform, consider using `@neondatabase/serverless` or a connection pooler like PgBouncer. The `postgres` (postgres.js) driver works well in both Node.js and edge environments.

## 4. Configure Drizzle Kit

Create `drizzle.config.ts` at the project root:

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

Generate and run migrations:

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

## 5. Create Server Actions with Transactions

In Next.js 15, server actions are async functions marked with `"use server"` that run exclusively on the server. They can be called directly from Client Components or Server Components.

### Basic Server Action (No Transaction)

Create `src/app/actions/user.ts`:

```ts
"use server";

import { db } from "@/db";
import { users } from "@/db/schema";
import { revalidatePath } from "next/cache";

export async function createUser(formData: FormData) {
  const name = formData.get("name") as string;
  const email = formData.get("email") as string;

  await db.insert(users).values({ name, email });

  revalidatePath("/users");
}
```

### Server Action with a Transaction

When you need to perform multiple related writes atomically, use `db.transaction()`. If any statement inside the transaction throws, all changes are rolled back automatically.

Create `src/app/actions/order.ts`:

```ts
"use server";

import { db } from "@/db";
import { users, orders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function createUserWithOrder(formData: FormData) {
  const name = formData.get("name") as string;
  const email = formData.get("email") as string;
  const product = formData.get("product") as string;
  const quantity = parseInt(formData.get("quantity") as string, 10);

  await db.transaction(async (tx) => {
    // Insert the user
    const [newUser] = await tx
      .insert(users)
      .values({ name, email })
      .returning({ id: users.id });

    // Insert the order linked to the new user
    await tx.insert(orders).values({
      userId: newUser.id,
      product,
      quantity,
    });
  });

  revalidatePath("/");
}
```

### Transaction with Error Handling and Rollback

```ts
"use server";

import { db } from "@/db";
import { users, orders } from "@/db/schema";
import { eq } from "drizzle-orm";

type ActionResult = {
  success: boolean;
  error?: string;
};

export async function placeOrder(formData: FormData): Promise<ActionResult> {
  const userId = parseInt(formData.get("userId") as string, 10);
  const product = formData.get("product") as string;
  const quantity = parseInt(formData.get("quantity") as string, 10);

  try {
    await db.transaction(async (tx) => {
      // Verify the user exists
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        // Throwing inside a transaction causes an automatic rollback
        throw new Error("User not found");
      }

      // Perform the insert
      await tx.insert(orders).values({
        userId,
        product,
        quantity,
      });
    });

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
```

### Nested Logic and Manual Rollback

Drizzle also supports savepoints if you need finer-grained control. You can call `tx.rollback()` to explicitly abort the transaction at any point:

```ts
"use server";

import { db } from "@/db";
import { orders } from "@/db/schema";

export async function conditionalInsert(formData: FormData) {
  const product = formData.get("product") as string;
  const quantity = parseInt(formData.get("quantity") as string, 10);

  const result = await db.transaction(async (tx) => {
    await tx.insert(orders).values({
      userId: 1,
      product,
      quantity,
    });

    // Some business logic check
    if (quantity > 1000) {
      // Explicitly roll back -- nothing is committed
      tx.rollback();
    }

    return { committed: true };
  });

  // If rollback was called, `result` will be undefined
  // because tx.rollback() throws a special error caught by Drizzle
}
```

## 6. Using Server Actions in Components

### From a Server Component (Form)

```tsx
// src/app/page.tsx
import { createUserWithOrder } from "@/app/actions/order";

export default function Home() {
  return (
    <form action={createUserWithOrder}>
      <input name="name" placeholder="Name" required />
      <input name="email" placeholder="Email" required />
      <input name="product" placeholder="Product" required />
      <input name="quantity" type="number" placeholder="Quantity" required />
      <button type="submit">Submit</button>
    </form>
  );
}
```

### From a Client Component (Programmatic Call)

```tsx
"use client";

import { useTransition } from "react";
import { placeOrder } from "@/app/actions/order";

export function OrderButton({ userId }: { userId: number }) {
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("userId", String(userId));
      formData.set("product", "Widget");
      formData.set("quantity", "5");

      const result = await placeOrder(formData);

      if (!result.success) {
        alert(result.error);
      }
    });
  };

  return (
    <button onClick={handleClick} disabled={isPending}>
      {isPending ? "Placing order..." : "Place Order"}
    </button>
  );
}
```

## 7. Key Points to Remember

- **`db.transaction(async (tx) => { ... })`** gives you a transaction object (`tx`) that you use instead of `db` for all queries inside the transaction. If the callback throws, the transaction is rolled back.
- **`tx.rollback()`** can be called to explicitly abort. It throws internally, so any code after it will not execute.
- **`.returning()`** is supported on PostgreSQL and lets you retrieve inserted/updated rows within the same statement, which is essential for getting generated IDs inside transactions.
- **Server actions** in Next.js 15 are the recommended way to handle mutations. They automatically work with forms, support progressive enhancement, and integrate with `revalidatePath` / `revalidateTag` for cache invalidation.
- **Error boundaries:** Wrap your server action calls in try/catch or return structured results (as shown above) so the client can handle failures gracefully.
- **Connection handling:** In serverless environments, each invocation may create a new connection. Use connection pooling (PgBouncer, Neon's serverless driver, or Supabase's connection pooler) to avoid exhausting your database connections.
