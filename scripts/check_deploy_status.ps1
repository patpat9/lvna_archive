Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public class CredChecker {
    [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);

    [DllImport("Advapi32.dll", EntryPoint = "CredFree", SetLastError = true)]
    public static extern void CredFree(IntPtr cred);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CREDENTIAL {
        public int Flags;
        public int Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public int CredentialBlobSize;
        public IntPtr CredentialBlob;
        public int Persist;
        public int AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    public static string ReadCredUtf8(string target) {
        IntPtr credPtr;
        if (CredRead(target, 1, 0, out credPtr)) {
            var cred = (CREDENTIAL)Marshal.PtrToStructure(credPtr, typeof(CREDENTIAL));
            byte[] bytes = new byte[cred.CredentialBlobSize];
            Marshal.Copy(cred.CredentialBlob, bytes, 0, cred.CredentialBlobSize);
            CredFree(credPtr);
            return Encoding.UTF8.GetString(bytes);
        }
        return null;
    }
}
"@

$token = [CredChecker]::ReadCredUtf8("GitHub - https://api.github.com/patpat9")
if (-not $token) {
    Write-Error "No token"
    exit 1
}
$headers = @{
    Authorization = "Bearer $token"
    Accept = "application/vnd.github.v3+json"
}
$runs = Invoke-RestMethod -Uri "https://api.github.com/repos/patpat9/lvna_archive/actions/runs?per_page=1" -Headers $headers
$latest = $runs.workflow_runs[0]
Write-Host "Latest Run: $($latest.id) - $($latest.name) - Status: $($latest.status) - Conclusion: $($latest.conclusion)"

$jobs = Invoke-RestMethod -Uri "https://api.github.com/repos/patpat9/lvna_archive/actions/runs/$($latest.id)/jobs" -Headers $headers
foreach ($j in $jobs.jobs) {
    Write-Host "Job: $($j.name) - Status: $($j.status) - Conclusion: $($j.conclusion)"
    $j.steps | Select-Object number, name, status, conclusion | Format-Table -AutoSize
}




