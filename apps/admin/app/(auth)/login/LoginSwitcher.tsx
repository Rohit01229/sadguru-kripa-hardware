"use client";

import { useState } from "react";
import { LoginForm } from "./LoginForm";
import { PinLoginForm } from "./PinLoginForm";

/**
 * Chooses between the PIN pad and the password form. The server decides whether a PIN is
 * available for this device; this only lets the user switch to the password at will.
 */
export function LoginSwitcher({
  storeName,
  pinAvailable,
  staffName,
}: {
  storeName: string;
  pinAvailable: boolean;
  staffName?: string;
}) {
  const [usePassword, setUsePassword] = useState(!pinAvailable);

  if (!usePassword) {
    return <PinLoginForm staffName={staffName} onUsePassword={() => setUsePassword(true)} />;
  }
  return <LoginForm storeName={storeName} />;
}
