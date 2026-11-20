import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
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
      callback: () => new Notice(greeting(this.settings.name)),
    });
  }

  async loadSettings(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...((await this.loadData()) as Partial<Settings> | null) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class SettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private plugin: __CLASS__,
  ) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl).setName("Name").addText((t) =>
      t.setValue(this.plugin.settings.name).onChange(async (v) => {
        this.plugin.settings.name = v;
        await this.plugin.saveSettings();
      }),
    );
  }
}
