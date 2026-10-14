/**
 * YouTube / Google OAuth 2.0 Token Verification Helper
 * Verifies if the provided refresh token was actually generated using
 * the specific Client ID and Client Secret provided by the user.
 */

export interface TokenVerificationResult {
  valid: boolean
  accessToken?: string
  error?: string
  channelIdExt?: string
  channelTitle?: string
  channelHandle?: string
}

export async function verifyGoogleRefreshToken(
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<TokenVerificationResult> {
  try {
    const cleanedClientId = clientId.trim()
    const cleanedClientSecret = clientSecret.trim()
    const cleanedRefreshToken = refreshToken.trim()

    // 1. Request new access token from Google OAuth endpoint using the credentials
    const params = new URLSearchParams()
    params.append('client_id', cleanedClientId)
    params.append('client_secret', cleanedClientSecret)
    params.append('refresh_token', cleanedRefreshToken)
    params.append('grant_type', 'refresh_token')

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    const data = await response.json()

    if (!response.ok) {
      let friendlyError = 'Refresh token is invalid or does not match the provided Client ID & Client Secret.'
      if (data.error === 'invalid_client') {
        friendlyError = 'Invalid Client ID or Client Secret. Google rejected these credentials.'
      } else if (data.error === 'invalid_grant') {
        friendlyError = 'Refresh token mismatch: This refresh token was not generated with this Client ID & Secret, or it has been revoked.'
      } else if (data.error_description) {
        friendlyError = `Google OAuth Error: ${data.error_description}`
      }
      return {
        valid: false,
        error: friendlyError,
      }
    }

    const accessToken = data.access_token

    // 2. Try fetching YouTube channel details using the verified access token
    let channelIdExt: string | undefined
    let channelTitle: string | undefined
    let channelHandle: string | undefined

    try {
      const ytResponse = await fetch(
        'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        }
      )

      if (ytResponse.ok) {
        const ytData = await ytResponse.json()
        if (ytData.items && ytData.items.length > 0) {
          const item = ytData.items[0]
          channelIdExt = item.id
          channelTitle = item.snippet?.title
          channelHandle = item.snippet?.customUrl // e.g. @ChannelName
        }
      }
    } catch {
      // Non-fatal if YouTube Data API quota or scopes don't allow listing
    }

    return {
      valid: true,
      accessToken,
      channelIdExt,
      channelTitle,
      channelHandle,
    }
  } catch (err: any) {
    return {
      valid: false,
      error: err.message || 'Failed to connect to Google OAuth service.',
    }
  }
}
