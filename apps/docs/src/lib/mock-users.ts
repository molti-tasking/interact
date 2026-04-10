export interface MockUser {
  id: string;
  name: string;
  role: string;
}

export const MOCK_USERS: MockUser[] = [
  // Scenario 1: Youth Soccer Registration
  { id: "alex", name: "Alex", role: "Coach" },
  { id: "maria", name: "Maria", role: "Team Parent" },
  // Scenario 2: Hiring a Sales Representative
  { id: "sarah", name: "Sarah", role: "Founder" },
  { id: "cofounder", name: "James", role: "Co-Founder" },
  // Scenario 3: Orthopedic Patient Records
  { id: "chen", name: "Chen", role: "Clinical Informatics Lead" },
  { id: "surgeon", name: "Dr. Park", role: "Lead Orthopedic Surgeon" },
  { id: "physio", name: "Lena", role: "Physiotherapist" },
];

/** Format user for provenance actor field, e.g. "Alex (Coach)" */
export function formatActor(user: MockUser): string {
  return `${user.name} (${user.role})`;
}
