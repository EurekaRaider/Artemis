using System;
using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;

sealed class PreviewFixture : Form {
  readonly Stopwatch clock = Stopwatch.StartNew();
  readonly Timer timer = new Timer { Interval = 1 };
  public PreviewFixture() {
    Text = "Artemis GPU native preview verification";
    ClientSize = new Size(1280, 720);
    StartPosition = FormStartPosition.Manual;
    Location = new Point(40, 40);
    DoubleBuffered = true;
    BackColor = Color.FromArgb(20, 40, 70);
    timer.Tick += delegate { Invalidate(); };
    timer.Start();
  }
  protected override void OnPaint(PaintEventArgs args) {
    base.OnPaint(args);
    using (var font = new Font("Segoe UI", 24))
      args.Graphics.DrawString("Artemis Windows GPU preview", font, Brushes.White, 20, 20);
    float phase = (float)(clock.Elapsed.TotalSeconds % 4 / 4);
    using (var brush = new SolidBrush(Color.FromArgb(77, 217, 186)))
      args.Graphics.FillRectangle(brush, 40 + phase * 1000, 280, 160, 160);
  }
  protected override void Dispose(bool disposing) {
    if (disposing) timer.Dispose();
    base.Dispose(disposing);
  }
}
static class PreviewProgram {
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint period);
  [DllImport("winmm.dll")] static extern uint timeEndPeriod(uint period);
  [STAThread] static void Main() {
    SetProcessDpiAwarenessContext(new IntPtr(-4));
    Application.EnableVisualStyles();
    timeBeginPeriod(1);
    try { Application.Run(new PreviewFixture()); }
    finally { timeEndPeriod(1); }
  }
}
