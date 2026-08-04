"use client";

import { Button } from "@hardware/ui";

/** Sign out of the platform console. The action is passed in from the server page. */
export function LogoutButton({ action }: { action: () => Promise<void> }) {
  return (
    <Button variant="outline" onClick={() => void action()}>
      Sign out
    </Button>
  );
}
