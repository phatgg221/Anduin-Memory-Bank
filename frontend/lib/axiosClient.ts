import axios from "axios";

// Relative base URL: browser-only. Never call services from Server Components.
export const axiosClient = axios.create({ baseURL: "/api", timeout: 30_000 });
