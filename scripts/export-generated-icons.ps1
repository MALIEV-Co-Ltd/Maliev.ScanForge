param([int]$Size = 128)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$iconRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../public/icons/generated'))
$exported = 0
foreach ($iconFile in Get-ChildItem -LiteralPath $iconRoot -Filter '*.png') {
    $source = $null
    $target = $null
    $graphics = $null
    $attributes = $null
    $temporary = "$($iconFile.FullName).exporting"
    try {
        $source = [Drawing.Bitmap]::FromFile($iconFile.FullName)
        if ($source.Width -eq $Size -and $source.Height -eq $Size) { continue }
        $target = [Drawing.Bitmap]::new($Size, $Size, [Drawing.Imaging.PixelFormat]::Format32bppArgb)
        $graphics = [Drawing.Graphics]::FromImage($target)
        $graphics.Clear([Drawing.Color]::Transparent)
        $graphics.CompositingMode = [Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $attributes = [Drawing.Imaging.ImageAttributes]::new()
        $attributes.SetWrapMode([Drawing.Drawing2D.WrapMode]::TileFlipXY)
        $scale = [Math]::Min($Size / $source.Width, $Size / $source.Height)
        $width = [int][Math]::Round($source.Width * $scale)
        $height = [int][Math]::Round($source.Height * $scale)
        $bounds = [Drawing.Rectangle]::new([int](($Size - $width) / 2), [int](($Size - $height) / 2), $width, $height)
        $graphics.DrawImage($source, $bounds, 0, 0, $source.Width, $source.Height, [Drawing.GraphicsUnit]::Pixel, $attributes)
        $target.Save($temporary, [Drawing.Imaging.ImageFormat]::Png)
        $source.Dispose()
        $source = $null
        [IO.File]::Move($temporary, $iconFile.FullName, $true)
        $exported++
    }
    finally {
        if ($attributes) { $attributes.Dispose() }
        if ($graphics) { $graphics.Dispose() }
        if ($target) { $target.Dispose() }
        if ($source) { $source.Dispose() }
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
    }
}
Write-Output "Exported $exported generated icons at ${Size}x${Size}; original images remain at their receipt paths."
