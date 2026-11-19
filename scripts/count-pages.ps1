# 워드로 문서를 열어 실제 쪽수를 셉니다(보고서 편집기의 "쪽수 확인" 버튼).
# 사용: powershell -File scripts/count-pages.ps1 <문서.docx>
param([string]$Path)
$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
  $doc = $word.Documents.Open((Resolve-Path $Path).Path, $false, $true)
  $pages = $doc.ComputeStatistics(2)
  $doc.Close($false)
  Write-Output $pages
} finally {
  $word.Quit()
}
