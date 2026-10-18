/** Deploy already owns the transport lock: verify its targets directly, never via background discovery. */
export async function verifyDeployConnections<T, Key extends string>(
  targets: readonly { bindingId: Key; label: string }[],
  getClient: (bindingId: Key) => { getStatus(): Promise<T> } | undefined,
): Promise<readonly { bindingId: Key; status: T }[]> {
  const verified: { bindingId: Key; status: T }[] = [];
  for (const target of targets) {
    const client = getClient(target.bindingId);
    if (!client)
      throw new Error(
        `${target.label}: collegamento non disponibile. Ricollega la Backbone e premi Ricontrolla.`,
      );
    try {
      verified.push({ bindingId: target.bindingId, status: await client.getStatus() });
    } catch {
      throw new Error(
        `${target.label}: non risponde alla verifica del collegamento. Ricollega la Backbone e premi Ricontrolla.`,
      );
    }
  }
  return verified;
}
