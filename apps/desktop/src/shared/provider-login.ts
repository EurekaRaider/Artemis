export interface ProviderLoginOption {
  providerId: string;
  name: string;
  type: "api_key" | "oauth";
}
export interface ProviderLoginState {
  id: string;
  providerId: string;
  status: "running" | "completed" | "failed" | "cancelled";
  messages: string[];
  links: Array<{ url: string; label: string }>;
  error?: string;
  prompt?: {
    id: string;
    type: "text" | "secret" | "select" | "manual_code";
    message: string;
    placeholder?: string;
    options?: Array<{ id: string; label: string; description?: string }>;
  };
}
