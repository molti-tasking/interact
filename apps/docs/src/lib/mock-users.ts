export interface MockUser {
  id: string;
  name: string;
  role: string;
}

export const MOCK_USERS: MockUser[] = [
  { id: "alice", name: "Alice", role: "Designer" },
  { id: "bob", name: "Bob", role: "Researcher" },
  { id: "carol", name: "Carol", role: "Admin" },
];
