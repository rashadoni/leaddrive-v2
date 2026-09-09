export async function sendVkMessage(
  userId: string,
  text: string,
  groupToken: string
): Promise<boolean> {
  try {
    const randomId = Math.floor(Math.random() * 2147483647)
    const params = new URLSearchParams({
      user_id: userId,
      message: text,
      random_id: String(randomId),
      access_token: groupToken,
      v: "5.131",
    })
    const res = await fetch(`https://api.vk.com/method/messages.send?${params}`)
    const json = await res.json()
    if (json.error) {
      console.error("VK send error:", json.error)
      return false
    }
    return true
  } catch (e) {
    console.error("VK send exception:", e)
    return false
  }
}
