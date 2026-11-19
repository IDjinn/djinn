import * as fs from "fs";
import * as vscode from "vscode";
import { amount } from "./format";
import { buildTree, topDetails } from "./tree";
import { FunctionEntry, ProfileModel, TreeNode } from "./types";

/** What a tree item stands for, so `getChildren` can expand it. */
type ItemNode = { kind: "node"; node: TreeNode } | { kind: "runtime" };

export class ProfileItem extends vscode.TreeItem {
  node?: ItemNode;
  entry?: FunctionEntry;
}

export class ProfileView implements vscode.TreeDataProvider<ProfileItem> {
  private model: ProfileModel | undefined;
  private projectOnly = false;
  private readonly emitter = new vscode.EventEmitter<ProfileItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  load(model: ProfileModel): void {
    this.model = model;
    this.emitter.fire(undefined);
  }

  clear(): void {
    this.model = undefined;
    this.emitter.fire(undefined);
  }

  setProjectOnly(value: boolean): void {
    this.projectOnly = value;
    this.emitter.fire(undefined);
  }

  getTreeItem(item: ProfileItem): vscode.TreeItem {
    return item;
  }

  private percent(model: ProfileModel, count: number): string {
    return ((count / model.total) * 100).toFixed(1);
  }

  private icon(fraction: number): vscode.ThemeIcon {
    return new vscode.ThemeIcon("flame", new vscode.ThemeColor(fraction >= 0.1 ? "charts.red" : fraction >= 0.03 ? "charts.orange" : "charts.foreground"));
  }

  private open(file: string | undefined, line: number): vscode.Command | undefined {
    if (!file || !fs.existsSync(file)) {
      return undefined;
    }
    return {
      command: "vscode.open",
      title: "Open",
      arguments: [vscode.Uri.file(file), { selection: new vscode.Range(line - 1, 0, line - 1, 0) }],
    };
  }

  private visibleFunctions(model: ProfileModel): FunctionEntry[] {
    return model.functions.filter((entry) => !this.projectOnly || entry.project);
  }

  private nodeItems(model: ProfileModel, node: TreeNode): ProfileItem[] {
    const items: ProfileItem[] = [];
    const children = [...node.children.values()].sort((a, b) => b.count - a.count);
    for (const child of children) {
      const hasChildren = child.children.size > 0 || (child.entry !== undefined && child.entry.sortedLines.length > 0);
      const item = new ProfileItem(child.name, hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      item.description = `${this.percent(model, child.count)}%  ·  ${amount(model, child.count)}`;
      item.iconPath =
        child.entry && child.children.size === 0
          ? this.icon(child.count / model.total)
          : new vscode.ThemeIcon(child.entry ? "symbol-method" : "symbol-namespace");
      item.node = { kind: "node", node: child };
      if (child.entry) {
        const unit = model.memory === true ? "first-touched memory" : model.memory ? "memory" : "samples";
        item.contextValue = "djinnFunction";
        item.tooltip = `${child.entry.name}\n${amount(model, child.entry.count)} of ${amount(model, model.total)} ${unit}`;
        item.command = this.open(child.entry.file, child.entry.line);
        item.entry = child.entry;
      }
      items.push(item);
    }
    return items;
  }

  private lineItems(model: ProfileModel, entry: FunctionEntry): ProfileItem[] {
    return entry.sortedLines.slice(0, 12).map((stat) => {
      const details = topDetails(stat, 1)[0];
      const item = new ProfileItem(`line ${stat.line}`, vscode.TreeItemCollapsibleState.None);
      item.description = `${this.percent(model, stat.count)}%  ·  ${details ? details.key : ""}`;
      item.iconPath = this.icon(stat.count / model.total);
      item.command = this.open(stat.file, stat.line);
      return item;
    });
  }

  private rootItems(model: ProfileModel): ProfileItem[] {
    const items: ProfileItem[] = [];
    const projectSamples = model.functions.filter((entry) => entry.project).reduce((sum, entry) => sum + entry.count, 0);
    const otherSamples = model.total - projectSamples;
    const label = model.memory ? `${amount(model, model.total)}${model.memory === true ? " touched" : ""}` : `${model.total} samples`;
    const summary = new ProfileItem(label, vscode.TreeItemCollapsibleState.None);
    summary.description = this.projectOnly
      ? `${this.percent(model, projectSamples)}% in project code (${this.percent(model, otherSamples)}% hidden)`
      : `${this.percent(model, projectSamples)}% project · ${this.percent(model, otherSamples)}% std, runtime, kernel`;
    summary.iconPath = new vscode.ThemeIcon(this.projectOnly ? "filter-filled" : "graph");
    items.push(summary);
    items.push(...this.nodeItems(model, buildTree(this.visibleFunctions(model))));
    if (!this.projectOnly && model.runtime.length > 0) {
      const group = new ProfileItem("Runtime, libc and kernel", vscode.TreeItemCollapsibleState.Collapsed);
      group.description = `${this.percent(model, model.runtimeCount + model.kernelOnly)}%`;
      group.tooltip = "Samples with no Djinn frame (the program was idle, in libc or in the kernel).";
      group.iconPath = new vscode.ThemeIcon("library");
      group.node = { kind: "runtime" };
      items.push(group);
    }
    return items;
  }

  getChildren(element?: ProfileItem): ProfileItem[] {
    const model = this.model;
    if (!model) {
      return [];
    }
    if (!element) {
      return this.rootItems(model);
    }
    const node = element.node;
    if (!node) {
      return [];
    }
    if (node.kind === "runtime") {
      return model.runtime.slice(0, 30).map((entry) => {
        const item = new ProfileItem(entry.name, vscode.TreeItemCollapsibleState.None);
        item.description = `${this.percent(model, entry.count)}%  ·  ${amount(model, entry.count)}`;
        return item;
      });
    }
    const items = this.nodeItems(model, node.node);
    if (node.node.entry) {
      items.push(...this.lineItems(model, node.node.entry));
    }
    return items;
  }
}
