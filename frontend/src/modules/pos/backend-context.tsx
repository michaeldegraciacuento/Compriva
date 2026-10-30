"use client";

import { createContext, useContext } from "react";

import { onlinePos, type PosBackend } from "./backend";

/** The POS backend for the screens below (online API, or the desktop's local database). */
export const PosBackendContext = createContext<PosBackend>(onlinePos);

export function usePos(): PosBackend {
  return useContext(PosBackendContext);
}
