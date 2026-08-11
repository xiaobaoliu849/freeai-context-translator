/**
 * Minimal ambient type declarations for the subset of the Chrome Extension API
 * used by this project (Manifest V3). Kept intentionally small instead of
 * pulling in @types/chrome.
 */
declare namespace chrome {
  namespace runtime {
    interface OnInstalledDetails {
      reason: 'install' | 'update' | 'chrome_update' | 'shared_module_update';
      previousVersion?: string;
    }
    interface MessageSender {
      tab?: chrome.tabs.Tab;
    }
    const onInstalled: {
      addListener(callback: (details: OnInstalledDetails) => void): void;
    };
    const onMessage: {
      addListener(
        callback: (
          message: any,
          sender: MessageSender,
          sendResponse: (response?: any) => void,
        ) => void,
      ): void;
    };
    const onConnect: {
      addListener(callback: (port: chrome.runtime.Port) => void): void;
    };
    const id: string | undefined;
    function getURL(path: string): string;

    interface Port {
      name: string;
      disconnect(): void;
      postMessage(message: any): void;
      onMessage: {
        addListener(callback: (message: any, port: Port) => void): void;
      };
      onDisconnect: {
        addListener(callback: (port: Port) => void): void;
      };
    }

    function connect(connectInfo?: { name?: string }): Port;
  }

  namespace contextMenus {
    interface CreateProperties {
      id?: string;
      title?: string;
      contexts?: string[];
    }
    interface OnClickData {
      menuItemId: string | number;
      selectionText?: string;
    }
    const onClicked: {
      addListener(callback: (info: OnClickData, tab: chrome.tabs.Tab) => void): void;
    };
    function create(properties: CreateProperties, callback?: () => void): void;
    function removeAll(callback?: () => void): void;
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
    }
    function sendMessage(tabId: number, message: any, callback?: (response: any) => void): void;
    function create(properties: { url: string }): void;
  }

  namespace commands {
    const onCommand: {
      addListener(callback: (command: string, tab: chrome.tabs.Tab) => void): void;
    };
  }

  namespace storage {
    namespace local {
      function get(
        keys: string | string[] | Record<string, any> | null,
        callback?: (items: Record<string, any>) => void,
      ): Promise<Record<string, any>>;
      function set(items: Record<string, any>): Promise<void>;
      function remove(keys: string | string[]): Promise<void>;
    }
  }
}
