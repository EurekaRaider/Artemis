import {
  BaseWindow,
  WebContentsView,
  type BrowserWindow,
  type Rectangle,
  type WebPreferences,
} from "electron";

/** A retained tab, parked in a hidden native window while its panel is absent. */
export class BrowserNativeWindow {
  private readonly window = new BaseWindow({
    show: false,
    width: 1280,
    height: 720,
    useContentSize: true,
    enableLargerThanScreen: true,
  });
  private readonly view: WebContentsView;
  readonly webContents;
  private owner: BaseWindow;
  private surface: { token: string; senderId: number } | undefined;
  private readonly ownerClosed = () => this.park();

  constructor(webPreferences: WebPreferences) {
    this.view = new WebContentsView({ webPreferences });
    this.webContents = this.view.webContents;
    this.owner = this.window;
    this.window.contentView.addChildView(this.view);
    this.view.setBounds({ x: 0, y: 0, width: 1280, height: 720 });
    this.window.once("closed", () => {
      this.detach();
      if (!this.webContents.isDestroyed())
        this.webContents.close({ waitForBeforeUnload: false });
    });
  }
  once(event: "closed", listener: () => void) {
    this.window.once(event, listener);
  }
  isDestroyed() {
    return this.window.isDestroyed();
  }
  getContentSize() {
    return this.window.getContentSize();
  }
  setContentSize(width: number, height: number) {
    this.window.setContentSize(width, height);
    if (this.owner === this.window)
      this.view.setBounds({ x: 0, y: 0, width, height });
  }
  setPosition(x: number, y: number) {
    this.window.setPosition(x, y);
  }
  present(owner: BrowserWindow, token: string, bounds: Rectangle | null) {
    const [width, height] = owner.getContentSize();
    const clipped = bounds && {
      ...bounds,
      width: Math.max(0, Math.min(bounds.width, width! - bounds.x)),
      height: Math.max(0, Math.min(bounds.height, height! - bounds.y)),
    };
    if (!clipped || clipped.width <= 0 || clipped.height <= 0) {
      // Hiding the view itself stalls CDP screenshots on macOS. Keep its
      // surface available in the hidden parking window while HTML covers it.
      this.park();
      this.surface = { token, senderId: owner.webContents.id };
      return;
    }
    if (this.owner !== owner) {
      this.detach();
      this.owner = owner;
      owner.contentView.addChildView(this.view);
      owner.once("closed", this.ownerClosed);
    }
    this.surface = { token, senderId: owner.webContents.id };
    this.view.setBounds(clipped);
    this.view.setVisible(true);
  }
  release(token: string, senderId: number) {
    if (this.surface?.token === token && this.surface.senderId === senderId)
      this.park();
  }
  removeContents(senderId: number) {
    if (this.surface?.senderId === senderId) this.park();
  }
  private detach() {
    this.owner.removeListener("closed", this.ownerClosed);
    if (!this.owner.isDestroyed())
      this.owner.contentView.removeChildView(this.view);
  }
  private park() {
    this.detach();
    this.surface = undefined;
    this.owner = this.window;
    if (this.window.isDestroyed()) return;
    this.window.contentView.addChildView(this.view);
    const [width, height] = this.getContentSize();
    this.view.setBounds({ x: 0, y: 0, width: width!, height: height! });
    this.view.setVisible(true);
  }
  destroy() {
    this.detach();
    if (!this.webContents.isDestroyed())
      this.webContents.close({ waitForBeforeUnload: false });
    this.window.destroy();
  }
}
