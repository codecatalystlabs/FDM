import { createContext, useContext } from "react";
import type { Download } from "./api";

/** App-wide actions any view can trigger (implemented in App.tsx). */
export type AppActions = {
  openSpotlight: (url?: string) => void;
  quickLook: (d: Download) => void;
};

export const ActionsContext = createContext<AppActions>({
  openSpotlight: () => {},
  quickLook: () => {},
});

export function useActions() {
  return useContext(ActionsContext);
}
