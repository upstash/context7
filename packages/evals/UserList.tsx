import { useQuery } from "@tanstack/react-query";

interface User {
  id: number;
  name: string;
  email: string;
  username: string;
}

async function fetchUsers(): Promise<User[]> {
  const response = await fetch("https://jsonplaceholder.typicode.com/users");
  if (!response.ok) {
    throw new Error(`Failed to fetch users: ${response.statusText}`);
  }
  return response.json();
}

function UserCard({ user }: { user: User }) {
  return (
    <li className="user-card">
      <div className="user-card__avatar" aria-hidden="true">
        {user.name.charAt(0).toUpperCase()}
      </div>
      <div className="user-card__info">
        <span className="user-card__name">{user.name}</span>
        <span className="user-card__meta">
          <a href={`mailto:${user.email}`}>{user.email}</a>
          {" · "}
          <span className="user-card__username">@{user.username}</span>
        </span>
      </div>
    </li>
  );
}

function LoadingSkeleton() {
  return (
    <ul className="user-list user-list--loading" aria-busy="true" aria-label="Loading users">
      {Array.from({ length: 5 }).map((_, i) => (
        <li key={i} className="user-card user-card--skeleton">
          <div className="user-card__avatar user-card__avatar--skeleton" />
          <div className="user-card__info">
            <div className="skeleton-line skeleton-line--name" />
            <div className="skeleton-line skeleton-line--meta" />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function UserList() {
  const {
    data: users,
    isPending,
    isError,
    error,
    refetch,
    isFetching,
  } = useQuery<User[], Error>({
    queryKey: ["users"],
    queryFn: fetchUsers,
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 2,
  });

  if (isPending) {
    return <LoadingSkeleton />;
  }

  if (isError) {
    return (
      <div className="user-list-error" role="alert">
        <p className="user-list-error__message">
          <strong>Could not load users.</strong> {error.message}
        </p>
        <button className="user-list-error__retry" onClick={() => refetch()}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="user-list-wrapper">
      <div className="user-list-header">
        <h2 className="user-list-header__title">
          Users <span className="user-list-header__count">({users.length})</span>
        </h2>
        <button
          className="user-list-header__refresh"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh user list"
        >
          {isFetching ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {users.length === 0 ? (
        <p className="user-list-empty">No users found.</p>
      ) : (
        <ul className="user-list" aria-label="User list">
          {users.map((user) => (
            <UserCard key={user.id} user={user} />
          ))}
        </ul>
      )}
    </div>
  );
}
