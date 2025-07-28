/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry, IWorkbenchContribution } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchThemeService } from '../../../services/themes/common/workbenchThemeService.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

const navigator = globalThis.navigator;
const WebSocket = globalThis.WebSocket;
const port = navigator.userAgent.match(/port\/(\d*)/);
const url = `ws://127.0.0.1:${port ? parseInt(port[1], 10) : 9974}`;

// 定义消息类型（可以根据实际消息结构扩展）
type Message = any; // 可以替换为具体的接口，如 { type: string; data: any }

// 定义回调函数类型
type MessageCallback = (msg: Message) => void;

class MessageCenterClient {
	private _protocol: string;
	private _ws: WebSocket | null;
	private _msgQueue: Message[];
	private _callback: MessageCallback[];

	constructor(protocol: string) {
		this._protocol = protocol;
		this._ws = null;
		this._msgQueue = [];
		this._callback = [];

		if (document.readyState === 'complete') {
			setTimeout(() => {
				this.connect();
			}, 0);
		} else {
			globalThis.addEventListener('load', () => {
				this.connect();
			});
		}
	}

	connect(): void {
		// 这里的 e 是从 prompt 获取的 token，类型为 string | null
		const e = prompt('GET_MESSAGE_TOKEN'); // 注意：prompt 返回的是 string | null

		if (e === null) {
			console.error('Failed to get message token.');
			return;
		}

		// 构造 WebSocket 的子协议字符串
		const subProtocol = `${this._protocol}#${e}#`;

		this._ws = new WebSocket(url, subProtocol);

		this._ws.onopen = () => {
			// 连接成功后，发送队列中的消息
			const msgQueue = [...this._msgQueue];
			this._msgQueue = [];
			msgQueue.forEach((msg) => {
				this.send(msg);
			});
		};

		this._ws.onclose = () => {
			this._ws = null;

			// 连接关闭后，尝试重新连接
			setTimeout(() => {
				this.connect();
			}, 1000); // 延迟 1 秒重连
		};

		this._ws.onmessage = (event) => {
			try {
				const msgJSON = event.data; // 注意：event 是 MessageEvent，data 是 string
				const msg: Message = JSON.parse(msgJSON);
				this._callback.forEach((cb) => {
					try {
						cb.call(this, msg);
					} catch (e) {
						// 忽略回调中的错误
						console.error('Error in message callback:', e);
					}
				});
			} catch (e) {
				// JSON 解析失败
				console.error('Failed to parse message:', e);
			}
		};

		this._ws.onerror = (error) => {
			console.error('WebSocket error:', error);
		};
	}

	send(msg: Message): void {
		if (this._ws && this._ws.readyState === WebSocket.OPEN) {
			this._ws.send(JSON.stringify(msg));
		} else {
			// 如果 WebSocket 未连接，将消息加入队列
			this._msgQueue.push(msg);
		}
	}

	registerCallback(callback: MessageCallback): void {
		if (typeof callback === 'function') {
			this._callback.push(callback);
		}
	}
}

export class WebviewBrigeContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkbenchThemeService private readonly themeService: IWorkbenchThemeService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();

		this.init();
	}

	private async init(): Promise<void> {
		const mc = new MessageCenterClient('EXTENSION_EDITOR');
		mc.registerCallback(({ command, data }) => {
			switch (command) {
				case 'openFile': {
					this.openFile(data.filePath);
					break;
				}
				case 'updateTheme': {
					const themeId = data === 'theme-2' ? 'Visual Studio Light' : 'Default Dark+';
					this.changeTheme(themeId);
					break;
				}
				case 'updateLocale': {
					const locale = data === 'zh-CN' ? 'zh-CN' : 'en';
					this.changeLanguage(locale);
					break;
				}
			}
		});
	}

	/**
	 * 相对于工作区根目录的文件路径
	 * @param filePath 文件路径
	 */
	public async openFile(filePath: string) {
		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		const folderUri = workspaceFolders[0].uri;
		const fileUri = URI.joinPath(folderUri, filePath);
		try {
			await this.editorService.openEditor({
				resource: fileUri, // 根据你的实际路径调整
				options: { pinned: true }
			});
		} catch (e) {
			console.error(`Failed to open ${filePath} :`, e);
		}
	}
	/**
	 * 修改主题方法
	 * @param settingsId 主题 ID 如 'Default Dark+', 'Default Light+'
	 */
	public async changeTheme(settingsId: string) {
		const themes = await this.themeService.getColorThemes();
		const theme = themes.find(theme => theme.settingsId === settingsId);
		if (theme) {
			await this.themeService.setColorTheme(theme, 'auto');
		} else {
			console.error(`Failed to find theme ${settingsId}`);
		}
	}

	/**
 * 修改编辑器语言
 * @param locale 语言代码，如 'zh-cn' 或 'en'
 */
	public async changeLanguage(locale: string) {
		try {
			await this.configurationService.updateValue('locale', locale);
		} catch (e) {
			console.error(`Failed to set locale to ${locale}:`, e);
		}
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(WebviewBrigeContribution, LifecyclePhase.Restored);

