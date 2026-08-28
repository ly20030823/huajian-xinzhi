import { invoke } from "@tauri-apps/api/core";

export interface CustomizationContent {
  greetingsMarkdown: string;
  aboutMarkdown: string;
  syncGuideMarkdown: string;
  directory: string;
}

export function getCustomizationContent(): Promise<CustomizationContent> {
  return invoke("customization_get");
}
