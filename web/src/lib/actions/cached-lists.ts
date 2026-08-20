import "server-only";

import { cache } from "react";
import { getListDestinations } from "./lists";

export const getCachedListDestinations = cache(getListDestinations);
