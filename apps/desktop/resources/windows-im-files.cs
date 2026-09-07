using System;
using System.IO;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32.SafeHandles;

// This broker runs as the desktop user, never as model-supplied PowerShell.
// Every ancestor is opened without FILE_SHARE_WRITE/DELETE, and every opened object
// rejects reparse points. Holding the chain prevents path replacement until I/O
// completes. File handles also exclude concurrent writes and hard-link changes.
public sealed class ArtemisImFiles : IDisposable
{
    public sealed class Entry
    {
        public string path;
        public bool directory;
        public string data;
    }
    public sealed class Change
    {
        public string path;
        public string data;
        public string expected;
        public bool directory;
        public bool delete;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Info
    {
        public uint attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME creation, access, write;
        public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Info info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder path, uint size, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateDirectoryW(string name, IntPtr security);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetFileInformationByHandle(SafeFileHandle handle, int kind, ref int data, uint size);
    private const uint Read = 0x80000000, Write = 0x40000000, Delete = 0x10000;
    private const uint Flags = 0x02000000 | 0x00200000; // BACKUP_SEMANTICS | OPEN_REPARSE_POINT
    private const int Limit = 10 * 1024 * 1024;
    private readonly string root;
    private readonly List<SafeFileHandle> locks = new List<SafeFileHandle>();
    private readonly Dictionary<string, SafeFileHandle> directories = new Dictionary<string, SafeFileHandle>(StringComparer.OrdinalIgnoreCase);
    private readonly string[] readable, writable, fileRoots;
    private readonly Regex protectedName;

    public ArtemisImFiles(string workspace, string[] readPaths, string[] writePaths, string[] files, string protection)
    {
        root = Path.GetFullPath(workspace).TrimEnd('\\');
        if (!Regex.IsMatch(root, @"^[A-Za-z]:\\")) throw new IOException("IM file access requires a local Windows drive.");
        readable = readPaths; writable = writePaths; fileRoots = files;
        protectedName = new Regex(protection, RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        try { LockDirectory(root, false); }
        catch { Dispose(); throw; }
    }
    public void Dispose()
    {
        for (int i = locks.Count - 1; i >= 0; i--) locks[i].Dispose();
        locks.Clear(); directories.Clear();
    }
    private static Info Inspect(SafeFileHandle handle)
    {
        Info info;
        if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if ((info.attributes & 0x400) != 0) throw new IOException("Reparse points are not allowed.");
        if ((info.attributes & 0x10) == 0 && info.links != 1) throw new IOException("Hard links are not allowed.");
        return info;
    }
    private SafeFileHandle Open(string path, uint access, uint disposition, bool directory)
    {
        // Sharing applies to this object, not its children. Excluding WRITE also
        // prevents turning an already-open directory into a reparse point in place.
        var handle = CreateFileW(path, access, 1u, IntPtr.Zero, disposition, Flags, IntPtr.Zero);
        if (handle.IsInvalid) { handle.Dispose(); throw new Win32Exception(Marshal.GetLastWin32Error()); }
        try
        {
            var info = Inspect(handle);
            var finalPath = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandleW(handle, finalPath, (uint)finalPath.Capacity, 0);
            if (length == 0 || length >= finalPath.Capacity) throw new IOException("Cannot verify the opened file path.");
            string actual = finalPath.ToString();
            if (actual.StartsWith(@"\\?\", StringComparison.Ordinal)) actual = actual.Substring(4);
            // 8.3 aliases must not disguise .env, credentials or control files.
            if (!String.Equals(actual.TrimEnd('\\'), path.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) throw new IOException("Aliased file paths are not allowed.");
            if (((info.attributes & 0x10) != 0) != directory) throw new IOException("File type changed.");
            locks.Add(handle); return handle;
        }
        catch { handle.Dispose(); throw; }
    }
    private void LockDirectory(string path, bool create)
    {
        if (directories.ContainsKey(path)) return;
        string volume = Path.GetPathRoot(path);
        if (!directories.ContainsKey(volume)) directories.Add(volume, Open(volume, 0x80, 3, true));
        string current = volume;
        foreach (string part in path.Substring(volume.Length).Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries))
        {
            current = Path.Combine(current, part);
            if (directories.ContainsKey(current)) continue;
            if (create && !Directory.Exists(current) && !CreateDirectoryW(current, IntPtr.Zero))
            {
                int code = Marshal.GetLastWin32Error();
                if (code != 183) throw new Win32Exception(code);
            }
            directories.Add(current, Open(current, 0x80, 3, true));
        }
    }
    private bool Protected(string name)
    {
        if (Regex.IsMatch(name, @"^\.env\.(example|sample|template)$", RegexOptions.IgnoreCase)) return false;
        return protectedName.IsMatch(name);
    }
    private string Checked(string path, bool write)
    {
        if (String.IsNullOrEmpty(path) || path.Length > 4096 || Regex.IsMatch(path, @"[\\:*?\[\]{}\x00-\x1f]")) throw new IOException("Invalid relative path.");
        foreach (var part in path.Split('/'))
        {
            if (part == "" || part == "." || part == ".." || part.EndsWith(".") || part.EndsWith(" ") || Protected(part) || Regex.IsMatch(part, @"^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\.|$)", RegexOptions.IgnoreCase)) throw new IOException("Protected or invalid path.");
        }
        foreach (var file in fileRoots) if (path.StartsWith(file + "/", StringComparison.Ordinal)) throw new IOException("File grant cannot expand into a directory.");
        bool allowed = false;
        foreach (var scope in write ? writable : readable) if (path == scope || path.StartsWith(scope + "/", StringComparison.Ordinal)) allowed = true;
        if (!allowed) throw new IOException("Path is outside the grant.");
        return Path.Combine(root, path.Replace('/', '\\'));
    }
    private byte[] Bytes(SafeFileHandle handle)
    {
        var info = Inspect(handle);
        if (info.sizeHigh != 0 || info.sizeLow > Limit) throw new IOException("File exceeds 10 MiB.");
        // The stream does not own the underlying lock, which stays alive until Dispose.
        using (var stream = new FileStream(new SafeFileHandle(handle.DangerousGetHandle(), false), FileAccess.Read))
        {
            byte[] bytes = new byte[info.sizeLow]; int total = 0;
            while (total < bytes.Length) { int count = stream.Read(bytes, total, bytes.Length - total); if (count == 0) throw new IOException("File changed."); total += count; }
            return bytes;
        }
    }
    public string ReadFile(string path)
    {
        string full = Checked(path, false); LockDirectory(Path.GetDirectoryName(full), false);
        return Convert.ToBase64String(Bytes(Open(full, Read, 3, false)));
    }
    public Entry[] List(string path)
    {
        string full = Checked(path, false);
        if (Array.IndexOf(fileRoots, path) >= 0) throw new IOException("File grant cannot expand into a directory.");
        LockDirectory(full, false);
        var result = new List<Entry>();
        foreach (var item in Directory.EnumerateFileSystemEntries(full))
        {
            string child = path + "/" + Path.GetFileName(item);
            try { Checked(child, false); } catch (IOException) { continue; }
            // Do not follow a child link even to decide its type.
            var handle = CreateFileW(item, 0x80, 3, IntPtr.Zero, 3, Flags, IntPtr.Zero);
            using (handle)
            {
                if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
                var info = Inspect(handle);
                result.Add(new Entry { path = child, directory = (info.attributes & 0x10) != 0 });
            }
            if (result.Count > 10000) throw new IOException("Directory exceeds 10000 entries.");
        }
        return result.ToArray();
    }
    private void Visit(string path, List<Entry> result, ref long total)
    {
        if (result.Count >= 10000) throw new IOException("Snapshot exceeds 10000 entries.");
        string full = Checked(path, false); LockDirectory(Path.GetDirectoryName(full), false);
        // Type inspection is no-follow; subsequent operations independently lock it.
        using (var handle = CreateFileW(full, 0x80, 3, IntPtr.Zero, 3, Flags, IntPtr.Zero))
        {
            if (handle.IsInvalid) { int code = Marshal.GetLastWin32Error(); if (code == 2 || code == 3) return; throw new Win32Exception(code); }
            if ((Inspect(handle).attributes & 0x10) != 0)
            {
                if (Array.IndexOf(fileRoots, path) >= 0) throw new IOException("File grant changed type.");
                result.Add(new Entry { path = path, directory = true });
                foreach (var child in List(path)) Visit(child.path, result, ref total);
                return;
            }
        }
        string data = ReadFile(path); total += (data.Length / 4L) * 3;
        if (total > 100 * 1024 * 1024) throw new IOException("Snapshot exceeds 100 MiB.");
        result.Add(new Entry { path = path, data = data });
    }
    public Entry[] Snapshot()
    {
        var result = new List<Entry>(); long total = 0;
        foreach (var path in readable)
        {
            bool nested = false;
            foreach (var other in readable) if (path != other && path.StartsWith(other + "/", StringComparison.Ordinal)) nested = true;
            if (!nested) Visit(path, result, ref total);
        }
        return result.ToArray();
    }
    private static string Hash(byte[] bytes)
    {
        using (var hash = SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
    }
    public Action Prepare(Change[] changes)
    {
        var actions = new List<Action>();
        foreach (var change in changes)
        {
            string full = Checked(change.path, true);
            if (change.directory)
            {
                if (Array.IndexOf(fileRoots, change.path) >= 0) throw new IOException("File grant cannot become a directory.");
                actions.Add(() => LockDirectory(full, true)); continue;
            }
            // Existing parents are held before the main process authorizes commit.
            string parent = Path.GetDirectoryName(full);
            string existingParent = parent;
            while (!Directory.Exists(existingParent)) existingParent = Path.GetDirectoryName(existingParent);
            LockDirectory(existingParent, false);
            SafeFileHandle target = null;
            bool present = File.Exists(full);
            if (present)
            {
                LockDirectory(parent, false);
                target = Open(full, Read | Write | (change.delete ? Delete : 0), 3, false);
                if (change.expected != null && (change.expected == "absent" || Hash(Bytes(target)) != change.expected)) throw new IOException("Original file changed; shell changes were not applied.");
            }
            else if (change.expected != null && change.expected != "absent") throw new IOException("Original file disappeared; shell changes were not applied.");
            byte[] data = change.data == null ? null : Convert.FromBase64String(change.data);
            if (data != null && data.Length > Limit) throw new IOException("File exceeds 10 MiB.");
            var captured = target;
            actions.Add(() =>
            {
                LockDirectory(parent, true);
                var handle = captured ?? Open(full, Read | Write, 1, false); // CREATE_NEW: never overwrite a replacement
                Inspect(handle);
                if (change.delete)
                {
                    int disposition = 1;
                    if (!SetFileInformationByHandle(handle, 4, ref disposition, 4)) throw new Win32Exception(Marshal.GetLastWin32Error());
                }
                else
                {
                    using (var stream = new FileStream(new SafeFileHandle(handle.DangerousGetHandle(), false), FileAccess.Write))
                    {
                        stream.SetLength(0); stream.Position = 0; stream.Write(data, 0, data.Length); stream.Flush();
                    }
                }
            });
        }
        return () => { foreach (var action in actions) action(); };
    }
}
