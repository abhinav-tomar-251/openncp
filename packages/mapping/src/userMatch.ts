export interface DirectoryUser {
  id: string;
  username?: string | null;
  email?: string | null;
}

/**
 * Match source-org users to target-org users by email (primary) or username
 * (fallback), both case-insensitively. Pure function — the actual Salesforce
 * queries live in the worker; this only does the matching logic, so it stays
 * cheaply unit-testable. This is how OwnerId gets remapped: users are never
 * created in the target org, only matched to whoever already exists there.
 * See docs/05-data-model-mapping.md §8.
 */
export function matchUsersByEmailOrUsername(
  sourceUsers: readonly DirectoryUser[],
  targetUsers: readonly DirectoryUser[],
): Map<string, string> {
  const byEmail = new Map<string, string>();
  const byUsername = new Map<string, string>();
  for (const t of targetUsers) {
    if (t.email) byEmail.set(t.email.toLowerCase(), t.id);
    if (t.username) byUsername.set(t.username.toLowerCase(), t.id);
  }

  const matches = new Map<string, string>();
  for (const s of sourceUsers) {
    const emailKey = s.email?.toLowerCase();
    const usernameKey = s.username?.toLowerCase();
    const targetId =
      (emailKey && byEmail.get(emailKey)) || (usernameKey && byUsername.get(usernameKey));
    if (targetId) matches.set(s.id, targetId);
  }
  return matches;
}
