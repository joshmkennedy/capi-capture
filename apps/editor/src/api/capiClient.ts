import type { CapiClient } from "./capiClientTypes"
import { mockCapiClient } from "./mockCapiClient"
import { runtimeCapiClient } from "./runtimeCapiClient"

export const capiClient: CapiClient =
  import.meta.env.VITE_CAPI_RUNTIME === "1" ? runtimeCapiClient : mockCapiClient

export const capiClientMode = import.meta.env.VITE_CAPI_RUNTIME === "1" ? "runtime" : "mock"
