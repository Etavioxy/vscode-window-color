import * as vscode from 'vscode';
import { WindowSettings, WindowReference, WindowGroup } from './extension';
import { getContrastColor, generateRandomColor } from './helpers';

type SsotWorkspaceSettings = {
    name?: string;
    mainColor?: string;
    isActivityBarColored?: boolean;
    isTitleBarColored?: boolean;
    isStatusBarColored?: boolean;
    isWindowNameColored?: boolean;
    isActiveItemsColored?: boolean;
    setWindowTitle?: boolean;
};

type SsotDocument = {
    windowColor?: {
        workspaceSettings?: Record<string, SsotWorkspaceSettings>;
    };
};

const LEGACY_WINDOW_COLOR_KEYS = [
    'name',
    'mainColor',
    'isActivityBarColored',
    'isTitleBarColored',
    'isStatusBarColored',
    'isWindowNameColored',
    'isActiveItemsColored',
    'setWindowTitle'
] as const;

function normalizeWorkspaceKey(value: string): string {
    return value.replace(/\\/g, '/').replace(/\/+$/g, '').toLowerCase();
}

function getSsotConfigPath(): string | undefined {
    const rawPath = vscode.workspace.getConfiguration('windowColor').get<string>('configPath');
    if (!rawPath || !rawPath.trim()) {
        return undefined;
    }
    return rawPath.trim();
}

export function getConfiguredSsotPath(): string | undefined {
    return getSsotConfigPath();
}

async function readSsotDocument(): Promise<SsotDocument | null> {
    const configPath = getSsotConfigPath();
    if (!configPath) {
        return null;
    }

    try {
        const uri = vscode.Uri.file(configPath);
        const raw = await vscode.workspace.fs.readFile(uri);
        return JSON.parse(raw.toString()) as SsotDocument;
    } catch {
        return null;
    }
}

async function writeSsotDocument(ssot: SsotDocument): Promise<void> {
    const configPath = getSsotConfigPath();
    if (!configPath) {
        throw new Error('windowColor.configPath is not configured');
    }
    const uri = vscode.Uri.file(configPath);
    const payload = `${JSON.stringify(ssot, null, 2)}\n`;
    await vscode.workspace.fs.writeFile(uri, Buffer.from(payload, 'utf8'));
}

async function readLegacySettingsFromWorkspace(directory: string): Promise<SsotWorkspaceSettings | null> {
    const uri = vscode.Uri.file(directory);
    const configPath = directory.endsWith('.code-workspace') ? uri : uri.with({ path: `${uri.path}/.vscode/settings.json` });

    let settings: any;
    try {
        const config = await vscode.workspace.fs.readFile(configPath);
        settings = JSON.parse(config.toString());
    } catch {
        return null;
    }

    const windowColorSettings = directory.endsWith('.code-workspace') ? (settings['settings'] || {}) : settings;
    const hasAnyLegacyKey = LEGACY_WINDOW_COLOR_KEYS.some(key => windowColorSettings[`windowColor.${key}`] !== undefined);
    if (!hasAnyLegacyKey) {
        return null;
    }

    return {
        name: windowColorSettings['windowColor.name'],
        mainColor: windowColorSettings['windowColor.mainColor'],
        isActivityBarColored: windowColorSettings['windowColor.isActivityBarColored'],
        isTitleBarColored: windowColorSettings['windowColor.isTitleBarColored'],
        isStatusBarColored: windowColorSettings['windowColor.isStatusBarColored'],
        isWindowNameColored: windowColorSettings['windowColor.isWindowNameColored'],
        isActiveItemsColored: windowColorSettings['windowColor.isActiveItemsColored'],
        setWindowTitle: windowColorSettings['windowColor.setWindowTitle']
    };
}

export async function hasLegacyWorkspaceSettings(directory: string): Promise<boolean> {
    return (await readLegacySettingsFromWorkspace(directory)) !== null;
}

function getSsotSettingsForDirectory(
    ssot: SsotDocument,
    directory: string
): SsotWorkspaceSettings | undefined {
    const workspaceSettings = ssot.windowColor?.workspaceSettings;
    if (!workspaceSettings) {
        return undefined;
    }

    const direct = workspaceSettings[directory];
    if (direct) {
        return direct;
    }

    const targetKey = normalizeWorkspaceKey(directory);
    const matchedKey = Object.keys(workspaceSettings).find(
        key => normalizeWorkspaceKey(key) === targetKey
    );
    return matchedKey ? workspaceSettings[matchedKey] : undefined;
}

export async function loadWorkspaces(): Promise<(WindowReference & { settings: WindowSettings })[]> {
    const references = loadWindowReferences();
    return await Promise.all(references.map(async ref => {
        const config = await loadWorkspaceConfig(ref.directory);
        return config ? { ...ref, ...{ settings: config } } : null;
    })).then(results => results.filter(Boolean) as (WindowReference & { settings: WindowSettings })[]);
}

export async function readConfig(directory: string): Promise<WindowSettings> {
    // console.log('[DEBUG] readConfig called for directory:', directory);
    const fallbackWindowName = directory.split('/').pop() || 'Untitled Window';

    const ssot = await readSsotDocument();
    if (ssot) {
        const ssotSettings = getSsotSettingsForDirectory(ssot, directory);
        if (ssotSettings) {
            const ssotMainColor = ssotSettings.mainColor || generateRandomColor();
            return {
                windowName: ssotSettings.name || fallbackWindowName,
                mainColor: ssotMainColor,
                mainColorContrast: getContrastColor(ssotMainColor),
                isActivityBarColored: ssotSettings.isActivityBarColored ?? false,
                isTitleBarColored: ssotSettings.isTitleBarColored ?? true,
                isStatusBarColored: ssotSettings.isStatusBarColored ?? true,
                isWindowNameColored: ssotSettings.isWindowNameColored ?? true,
                isActiveItemsColored: ssotSettings.isActiveItemsColored ?? true,
                setWindowTitle: ssotSettings.setWindowTitle ?? false
            };
        }
    }

    const uri = vscode.Uri.file(directory);
    const configPath = directory.endsWith('.code-workspace') ? uri : uri.with({ path: `${uri.path}/.vscode/settings.json` });
    // console.log('[DEBUG] Reading config from path:', configPath.fsPath);

    let settings: any;
    try {
        const config = await vscode.workspace.fs.readFile(configPath);
        settings = JSON.parse(config.toString());
        // console.log('[DEBUG] Config file contents:', JSON.stringify(settings, null, 2));
    } catch (error: any) {
        console.error(`Failed to read config file at ${configPath.fsPath}: ${error.message}`);
        settings = {};
    }

    const windowColorSettings = directory.endsWith('.code-workspace') ? (settings['settings'] || {}) : settings;
    // console.log('[DEBUG] Extracted windowColorSettings:', JSON.stringify(windowColorSettings, null, 2));
    
    // Only generate random color if no color exists
    const existingColor = windowColorSettings['windowColor.mainColor'];
    const mainColor = existingColor || generateRandomColor();
    // console.log('[DEBUG] Using main color:', mainColor, '(existing:', existingColor, ')');

    const result = {
        windowName: windowColorSettings['windowColor.name'] || fallbackWindowName,
        mainColor: mainColor,
        mainColorContrast: getContrastColor(mainColor),
        isActivityBarColored: windowColorSettings['windowColor.isActivityBarColored'] ?? false,
        isTitleBarColored: windowColorSettings['windowColor.isTitleBarColored'] ?? false,
        isStatusBarColored: windowColorSettings['windowColor.isStatusBarColored'] ?? true,
        isWindowNameColored: windowColorSettings['windowColor.isWindowNameColored'] ?? true,
        isActiveItemsColored: windowColorSettings['windowColor.isActiveItemsColored'] ?? true,
        setWindowTitle: windowColorSettings['windowColor.setWindowTitle'] ?? true
    };
    // console.log('[DEBUG] readConfig returning:', JSON.stringify(result, null, 2));
    return result;
}

export async function saveWindowReference(reference: WindowReference): Promise<void> {
    const config = vscode.workspace.getConfiguration('windowColor');
    const references = config.get<WindowReference[]>('workspaces') || [];
    const existingIndex = references.findIndex(ref => ref.directory === reference.directory);

    if (existingIndex >= 0) {
        references[existingIndex] = reference;
    } else {
        references.push(reference);
    }

    await config.update('workspaces', references, vscode.ConfigurationTarget.Global);
}

export async function deleteWindowReference(directory: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('windowColor');
    let references = config.get<WindowReference[]>('workspaces') || [];
    references = references.filter(ref => ref.directory !== directory);
    await config.update('workspaces', references, vscode.ConfigurationTarget.Global);
}

export async function moveWorkspace(draggedDirectory: string, targetDirectory: string): Promise<void> {
    const groups = loadWindowGroups();

    const draggedGroup = groups.find(group => group.windows.some(window => window.directory === draggedDirectory));
    const targetGroup = groups.find(group => group.windows.some(window => window.directory === targetDirectory));

    if (!draggedGroup || !targetGroup) {
        throw new Error('Both dragged and target directories must belong to a group');
    }

    const draggedWindow = draggedGroup.windows.find(window => window.directory === draggedDirectory);
    if (!draggedWindow) {
        throw new Error('Dragged window not found in its group');
    }

    // Remove the window from the dragged group
    draggedGroup.windows = draggedGroup.windows.filter(window => window.directory !== draggedDirectory);

    // If the dragged and target directories are in the same group, update the group
    if (draggedGroup === targetGroup) {
        const targetIndex = targetGroup.windows.findIndex(window => window.directory === targetDirectory);
        targetGroup.windows.splice(targetIndex, 0, draggedWindow);
    } else {
        // Otherwise, move it to the new group before the target
        const targetIndex = targetGroup.windows.findIndex(window => window.directory === targetDirectory);
        targetGroup.windows.splice(targetIndex, 0, draggedWindow);
    }

    await saveWindowGroup(draggedGroup);
    await saveWindowGroup(targetGroup);
}

export async function saveWindowGroup(group: WindowGroup): Promise<void> {
    const config = vscode.workspace.getConfiguration('windowColor');
    const groups = config.get<WindowGroup[]>('groups') || [];
    const existingIndex = groups.findIndex(g => g.name === group.name);

    if (existingIndex >= 0) {
        groups[existingIndex] = group;
    } else {
        groups.push(group);
    }

    await config.update('groups', groups, vscode.ConfigurationTarget.Global);
}

export async function deleteWindowGroup(groupName: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('windowColor');
    let groups = config.get<WindowGroup[]>('groups') || [];
    groups = groups.filter(g => g.name !== groupName);
    await config.update('groups', groups, vscode.ConfigurationTarget.Global);
}

export function loadWindowReferences(): WindowReference[] {
    const config = vscode.workspace.getConfiguration('windowColor');
    return config.get<WindowReference[]>('workspaces') || [];
}

export function loadWindowGroups(): WindowGroup[] {
    const config = vscode.workspace.getConfiguration('windowColor');
    return config.get<WindowGroup[]>('groups') || [];
}

export async function loadWorkspaceConfig(directory: string): Promise<WindowSettings | null> {
    try {
        return await readConfig(directory);
    } catch (error: any) {
        console.error(`Failed to load workspace config for ${directory}: ${error.message}`);
        return null;
    }
}

export async function saveToWorkspaceConfig(key: string, value: string | boolean | undefined): Promise<void> {
    // console.log('[DEBUG] saveToWorkspaceConfig called with key:', key, 'value:', value);
    const config = vscode.workspace.getConfiguration('windowColor');
    await config.update(key, value, vscode.ConfigurationTarget.Workspace);
    // console.log('[DEBUG] saveToWorkspaceConfig completed for key:', key);
}

export async function migrateLegacyToSsot(directory: string): Promise<{ migrated: boolean; message: string }> {
    const configPath = getSsotConfigPath();
    if (!configPath) {
        return { migrated: false, message: 'windowColor.configPath is not configured' };
    }

    const legacy = await readLegacySettingsFromWorkspace(directory);
    if (!legacy) {
        return { migrated: false, message: 'No legacy workspace settings found' };
    }

    const ssot = (await readSsotDocument()) || {};
    if (!ssot.windowColor) {
        ssot.windowColor = {};
    }
    if (!ssot.windowColor.workspaceSettings) {
        ssot.windowColor.workspaceSettings = {};
    }
    const previous = getSsotSettingsForDirectory(ssot, directory) || {};
    ssot.windowColor.workspaceSettings[directory] = {
        ...previous,
        ...legacy
    };
    await writeSsotDocument(ssot);

    await Promise.all(LEGACY_WINDOW_COLOR_KEYS.map(k => saveToWorkspaceConfig(k, undefined)));
    return { migrated: true, message: `Migrated legacy settings to SSOT: ${configPath}` };
}

export async function migrateSsotToLegacy(directory: string): Promise<{ migrated: boolean; message: string }> {
    const ssot = await readSsotDocument();
    if (!ssot) {
        return { migrated: false, message: 'SSOT document not found' };
    }

    const settings = getSsotSettingsForDirectory(ssot, directory);
    if (!settings) {
        return { migrated: false, message: 'No SSOT workspace settings found for current workspace' };
    }

    await Promise.all([
        saveToWorkspaceConfig('name', settings.name),
        saveToWorkspaceConfig('mainColor', settings.mainColor),
        saveToWorkspaceConfig('isActivityBarColored', settings.isActivityBarColored),
        saveToWorkspaceConfig('isTitleBarColored', settings.isTitleBarColored),
        saveToWorkspaceConfig('isStatusBarColored', settings.isStatusBarColored),
        saveToWorkspaceConfig('isWindowNameColored', settings.isWindowNameColored),
        saveToWorkspaceConfig('isActiveItemsColored', settings.isActiveItemsColored),
        saveToWorkspaceConfig('setWindowTitle', settings.setWindowTitle)
    ]);

    return { migrated: true, message: 'Migrated SSOT settings back to legacy workspace settings' };
}

export async function saveWindowSettingsToSsot(directory: string, settings: WindowSettings): Promise<void> {
    const configPath = getSsotConfigPath();
    if (!configPath) {
        // Backward-compatible fallback when SSOT path is not configured.
        await Promise.all([
            saveToWorkspaceConfig('name', settings.windowName),
            saveToWorkspaceConfig('mainColor', settings.mainColor),
            saveToWorkspaceConfig('isActivityBarColored', settings.isActivityBarColored),
            saveToWorkspaceConfig('isTitleBarColored', settings.isTitleBarColored),
            saveToWorkspaceConfig('isStatusBarColored', settings.isStatusBarColored),
            saveToWorkspaceConfig('isWindowNameColored', settings.isWindowNameColored),
            saveToWorkspaceConfig('isActiveItemsColored', settings.isActiveItemsColored),
            saveToWorkspaceConfig('setWindowTitle', settings.setWindowTitle)
        ]);
        return;
    }

    const ssot = (await readSsotDocument()) || {};
    if (!ssot.windowColor) {
        ssot.windowColor = {};
    }
    if (!ssot.windowColor.workspaceSettings) {
        ssot.windowColor.workspaceSettings = {};
    }

    const previousSettings = getSsotSettingsForDirectory(ssot, directory) || {};
    ssot.windowColor.workspaceSettings[directory] = {
        ...previousSettings,
        name: settings.windowName,
        mainColor: settings.mainColor,
        isActivityBarColored: settings.isActivityBarColored,
        isTitleBarColored: settings.isTitleBarColored,
        isStatusBarColored: settings.isStatusBarColored,
        isWindowNameColored: settings.isWindowNameColored,
        isActiveItemsColored: settings.isActiveItemsColored,
        setWindowTitle: settings.setWindowTitle
    };

    await writeSsotDocument(ssot);
}

export async function saveWorkspaceToGroup(groupName: string, workspace: WindowReference): Promise<void> {
    const config = vscode.workspace.getConfiguration('windowColor');
    const groups = config.get<WindowGroup[]>('groups') || [];
    const group = groups.find(g => g.name === groupName) || { name: groupName, windows: [] };
    group.windows.push(workspace);
    await saveWindowGroup(group);
}

export async function renameWindowGroup(oldName: string, newName: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('windowColor');
    let groups = config.get<WindowGroup[]>('groups') || [];
    const group = groups.find(g => g.name === oldName);

    if (group) {
        group.name = newName;
        await config.update('groups', groups, vscode.ConfigurationTarget.Global);
    }
}

export async function applyColorCustomizations(customizations: any) {
    // console.log('[DEBUG] applyColorCustomizations called with:', JSON.stringify(customizations, null, 2));
    const config = vscode.workspace.getConfiguration();
    try {
        // Get existing color customizations to preserve any user-defined colors
        const existingCustomizations = config.get<any>("workbench.colorCustomizations") || {};
        // console.log('[DEBUG] Existing color customizations:', JSON.stringify(existingCustomizations, null, 2));
        
        // Merge with new customizations (new ones override existing)
        const mergedCustomizations = {
            ...existingCustomizations,
            ...customizations["workbench.colorCustomizations"]
        };
        
        // Remove null values to clear disabled colors
        Object.keys(mergedCustomizations).forEach(key => {
            if (mergedCustomizations[key] === null) {
                delete mergedCustomizations[key];
            }
        });
        // console.log('[DEBUG] Merged color customizations:', JSON.stringify(mergedCustomizations, null, 2));
        
        await config.update(
            "workbench.colorCustomizations",
            mergedCustomizations,
            vscode.ConfigurationTarget.Workspace
        );
        // console.log('[DEBUG] Color customizations successfully applied to workspace');
    } catch (error: any) {
        console.error('[DEBUG] Failed to apply color customizations:', error.message);
        vscode.window.showErrorMessage(`Failed to apply color customizations: ${error.message}`);
    }
}
