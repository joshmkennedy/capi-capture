async function readJsonResponse<T>(response: Response, fallbackError: string): Promise<T> {
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null

  if (!response.ok) {
    throw new Error(body?.error ?? fallbackError)
  }

  if (!body) {
    throw new Error(fallbackError)
  }

  return body
}

export async function getJson<T>(url: string, fallbackError: string): Promise<T> {
  const response = await fetch(url)
  return readJsonResponse<T>(response, fallbackError)
}

export async function postJson<T>(
  url: string,
  payload: unknown,
  fallbackError: string,
): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  })

  return readJsonResponse<T>(response, fallbackError)
}
