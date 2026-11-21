import { Notice, Plugin, PluginSettingTab, SettingDefinitionItem } from "obsidian";
import { greeting } from "./core.ts";

interface Settings {
  name: string;
}

const DEFAULT_SETTINGS: Settings = { name: "world" };

export default class __CLASS__ extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };

  async onload(): Promise<void> {
    await this.loadSettings();
    this.addSettingTab(new SettingTab(this.app, this));
    this.addCommand({
      id: "say-hello",
      name: "Say hello",
      callback: () => new Notice(`__NAME__: ${greeting(this.settings.name)}`), // notices name the plugin
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<Settings> | null) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

/**
 * Declarative settings tab (Obsidian 1.13+): its rows show up in Obsidian's settings search. A control reads
 * `plugin.settings[key]` and saves with `saveData` on change. Override `setControlValue` to validate or react.
 */
class SettingTab extends PluginSettingTab {
  getSettingDefinitions(): SettingDefinitionItem[] {
    return [{ name: "Name", desc: "Who the command greets.", control: { type: "text", key: "name" } }];
  }
}
