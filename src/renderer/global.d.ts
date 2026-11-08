import type { HubApi } from "../shared/ipc";

declare global {
  interface Window {
    hub: HubApi;
  }
}

export {};
