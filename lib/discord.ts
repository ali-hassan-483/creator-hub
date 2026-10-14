/**
 * Discord webhook notification sender.
 * Exact notification types and payload schemas to be configured in Phase 6.
 */
export async function sendDiscordNotification(
  webhookUrl: string,
  message: string,
  embeds?: object[]
): Promise<void> {
  try {
    const body: Record<string, unknown> = { content: message }
    if (embeds?.length) body.embeds = embeds

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      console.error(`[Discord] Webhook returned error: ${res.status} ${res.statusText}`)
    }
  } catch (err) {
    console.error('[Discord] Failed to send notification:', err)
  }
}
