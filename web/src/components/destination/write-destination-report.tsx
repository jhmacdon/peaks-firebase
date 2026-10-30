"use client";

import { useAuth } from "../../lib/auth-context";
import { Button } from "../ui/button";

export function WriteDestinationReport({ destinationId }: { destinationId: string }) {
  const { user } = useAuth();
  return user ? <Button href={`/reports/new?dest=${encodeURIComponent(destinationId)}`} size="sm">Write a report</Button> : null;
}
