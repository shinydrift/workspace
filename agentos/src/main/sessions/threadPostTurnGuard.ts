export function validateThreadPostTurnId(expectedTurnId: string | undefined, providedTurnId: string | undefined): void {
  if (expectedTurnId) {
    if (providedTurnId !== expectedTurnId) throw new Error('Stale or missing turn_id for thread post');
    return;
  }
  if (providedTurnId) throw new Error('Stale turn_id for thread post');
}
