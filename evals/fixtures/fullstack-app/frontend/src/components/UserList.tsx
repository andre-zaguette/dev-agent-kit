import { useEffect, useState } from 'react';
import { request } from '../api/client';

interface User {
  id: string;
  email: string;
  name: string;
}

export function UserList() {
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => {
    request<User[]>('/api/users').then(setUsers);
  }, []);
  return (
    <ul>
      {users.map((u) => (
        <li key={u.id}>
          {u.name} ({u.email})
        </li>
      ))}
    </ul>
  );
}
