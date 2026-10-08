using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Threading;

sealed class Fixture : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  readonly TextBox input = new TextBox { AccessibleName = "Name", Location = new Point(30, 30), Size = new Size(280, 30) };
  readonly Label output = new Label { Text = "Ready", AccessibleName = "Ready", Location = new Point(30, 95), Size = new Size(450, 30) };
  readonly Panel transient = new Panel { Location = new Point(480, 250), Size = new Size(10, 10) };
  public Fixture() {
    Text = "Artemis Computer Use fixture"; StartPosition = FormStartPosition.Manual;
    Location = new Point(200, 180); ClientSize = new Size(550, 300); AutoScaleMode = AutoScaleMode.Dpi;
    var save = new Button { Text = "Save draft", Location = new Point(330, 28), Size = new Size(160, 36) };
    save.Click += delegate { output.Text = "Saved: " + input.Text; output.AccessibleName = output.Text; };
    var toggle = new Button { Text = "Toggle container", Location = new Point(30, 140), Size = new Size(180, 36) };
    toggle.Click += delegate { if (Controls.Contains(transient)) Controls.Remove(transient); else Controls.Add(transient); };
    var move = new Button { Text = "Move window", Location = new Point(230, 140), Size = new Size(160, 36) };
    move.Click += delegate { Location = new Point(Left + 35, Top + 25); };
    var modal = new Button { Text = "Open modal", Location = new Point(30, 195), Size = new Size(160, 36) };
    modal.Click += delegate { BeginInvoke(new Action(delegate {
      using (var dialog = new Form { Text = "Computer Use modal fixture", ClientSize = new Size(300, 150), StartPosition = FormStartPosition.CenterParent }) {
        var close = new Button { Text = "Close modal", Location = new Point(50, 40), Size = new Size(160, 36) };
        close.Click += delegate { dialog.Close(); }; dialog.Controls.Add(close); dialog.ShowDialog(this);
      }
    })); };
    var password = new TextBox { AccessibleName = "Password fixture", UseSystemPasswordChar = true, Text = "PRIVATE_FIXTURE_VALUE", Location = new Point(230, 195), Size = new Size(160, 30) };
    Controls.AddRange(new Control[] { input, save, output, toggle, move, modal, password });
    Shown += delegate { Console.WriteLine("Synthetic app launching"); Console.Out.Flush(); };
  }
}
static class Program {
  [StructLayout(LayoutKind.Sequential)] struct MouseInput {public int x,y;public uint data,flags,time;public UIntPtr extra;}
  [StructLayout(LayoutKind.Sequential)] struct KeyInput {public ushort key,scan;public uint flags,time;public UIntPtr extra;}
  [StructLayout(LayoutKind.Explicit)] struct InputUnion {[FieldOffset(0)]public MouseInput mouse;[FieldOffset(0)]public KeyInput key;}
  [StructLayout(LayoutKind.Sequential)] struct Input {public uint type;public InputUnion value;}
  [StructLayout(LayoutKind.Sequential)] struct Rectangle {public int left,top,right,bottom;}
  [DllImport("user32.dll")] static extern uint SendInput(uint count,Input[] input,int size);
  [DllImport("user32.dll")] static extern IntPtr FindWindow(string name,string title);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window,out Rectangle bounds);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  static void ExternalInput(string command) {
    if(command=="input-key") {
      var down=new Input {type=1,value=new InputUnion {key=new KeyInput {key=0x10}}}; var up=down;up.value.key.flags=2;
      SendInput(2,new[]{down,up},Marshal.SizeOf(typeof(Input)));
    } else if(command.StartsWith("stop:")) {
      var window=FindWindow("ArtemisComputerStop",null);uint pid; GetWindowThreadProcessId(window,out pid);
      if(window==IntPtr.Zero || pid!=uint.Parse(command.Substring(5))) throw new Exception("Wrong test Stop window");
      Rectangle bounds;GetWindowRect(window,out bounds);SetCursorPos((bounds.left+bounds.right)/2,(bounds.top+bounds.bottom)/2);
      var down=new Input {type=0,value=new InputUnion {mouse=new MouseInput {flags=2}}};var up=down;up.value.mouse.flags=4;
      SendInput(2,new[]{down,up},Marshal.SizeOf(typeof(Input)));
    }
  }
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [STAThread] static void Main() {
    SetProcessDpiAwarenessContext(new IntPtr(-4));
    Application.EnableVisualStyles();
    Application.SetCompatibleTextRenderingDefault(false);
    var fixture=new Fixture();
    var reader=new Thread(()=>{string command;while((command=Console.ReadLine())!=null) {try {ExternalInput(command);Console.WriteLine("Command: "+command);Console.Out.Flush();}catch(Exception error){Console.WriteLine("Command failed: "+error.Message);Console.Out.Flush();}}});reader.IsBackground=true;reader.Start();
    Application.Run(fixture);
  }
}
