#!/bin/bash
# Download GPX files from Hiking Project for Colorado 14ers
# URL pattern: https://www.hikingproject.com/trail/gpx/{trail_id}

DIR="$(cd "$(dirname "$0")" && pwd)"
TOTAL=0
SUCCESS=0
FAILED=0

download() {
  local trail_id="$1"
  local peak="$2"
  local route="$3"
  local filename="${peak}--${route}.gpx"
  # Sanitize filename
  filename=$(echo "$filename" | tr ' ' '-' | tr -cd 'A-Za-z0-9._-')

  local url="https://www.hikingproject.com/trail/gpx/${trail_id}"
  local outfile="$DIR/$filename"

  TOTAL=$((TOTAL + 1))

  if [ -f "$outfile" ] && [ -s "$outfile" ]; then
    echo "  SKIP $filename (already exists)"
    SUCCESS=$((SUCCESS + 1))
    return
  fi

  local status=$(curl -s -o "$outfile" -w "%{http_code}" -L "$url")

  if [ "$status" = "200" ] && [ -s "$outfile" ]; then
    # Verify it's actually GPX (XML)
    if head -5 "$outfile" | grep -q "gpx\|xml"; then
      echo "  ✓ $filename"
      SUCCESS=$((SUCCESS + 1))
    else
      echo "  ✗ $filename (not GPX content, status $status)"
      rm -f "$outfile"
      FAILED=$((FAILED + 1))
    fi
  else
    echo "  ✗ $filename (HTTP $status)"
    rm -f "$outfile"
    FAILED=$((FAILED + 1))
  fi

  # Rate limit
  sleep 0.5
}

echo "=== Downloading Colorado 14er GPX tracks from Hiking Project ==="
echo ""

# Trail IDs sourced from hikingproject.com search results
# Format: download TRAIL_ID "PEAK_NAME" "ROUTE_NAME"

# Mount Elbert (14,439')
download 7002038 "Mount-Elbert" "Northeast-Ridge"
download 7054704 "Mount-Elbert" "South-Trail"
download 7002210 "Mount-Elbert" "Black-Cloud-Trail"

# Mount Massive (14,421')
download 7002039 "Mount-Massive" "East-Slopes"

# Mount Harvard (14,420')
download 7002209 "Mount-Harvard" "South-Slopes"

# Blanca Peak (14,345')
download 7011303 "Blanca-Peak" "Northwest-Face"

# La Plata Peak (14,336')
download 7002208 "La-Plata-Peak" "Northwest-Ridge"

# Uncompahgre Peak (14,309')
download 7003337 "Uncompahgre-Peak" "South-Ridge"

# Crestone Peak (14,294')
download 7011406 "Crestone-Peak" "South-Face"

# Mount Lincoln (14,286')
download 7002203 "Mount-Lincoln" "West-Ridge"

# Grays Peak (14,270') + Torreys Peak (14,267')
download 7003636 "Grays-Torreys" "Standard-Route"

# Castle Peak (14,265')
download 7002710 "Castle-Peak" "Northeast-Ridge"

# Quandary Peak (14,265')
download 7002074 "Quandary-Peak" "East-Ridge"

# Mount Antero (14,269')
download 7004384 "Mount-Antero" "West-Slopes"

# Mount Blue Sky / Evans (14,264')
download 7001739 "Mount-Bierstadt" "West-Slopes"

# Longs Peak (14,255')
download 7000130 "Longs-Peak" "Keyhole-Route"

# Mount Wilson (14,246')
download 7011268 "Mount-Wilson" "Standard-Route"

# Mount Shavano (14,229')
download 7004393 "Mount-Shavano" "East-Slopes"

# Mount Belford (14,197')
download 7004361 "Mount-Belford" "West-Slopes"

# Mount Princeton (14,197')
download 7005919 "Mount-Princeton" "East-Slopes"

# Mount Yale (14,196')
download 7004368 "Mount-Yale" "East-Ridge"

# Crestone Needle (14,197')
download 7011407 "Crestone-Needle" "South-Face"

# Kit Carson Peak (14,165')
download 7011408 "Kit-Carson-Peak" "Standard-Route"

# Maroon Peak (14,156')
download 7011176 "Maroon-Peak" "South-Ridge"

# Mount Oxford (14,153')
download 7004362 "Mount-Oxford" "West-Ridge"

# Tabeguache Peak (14,155')
download 7004394 "Tabeguache-Peak" "Southwest-Ridge"

# Mount Sneffels (14,150')
download 7003650 "Mount-Sneffels" "South-Slopes"

# Mount Democrat (14,148')
download 7002203 "Mount-Democrat" "East-Slopes"

# Capitol Peak (14,130')
download 7011175 "Capitol-Peak" "Northeast-Ridge"

# Pikes Peak (14,110')
download 7000199 "Pikes-Peak" "Barr-Trail"

# Snowmass Mountain (14,092')
download 7011178 "Snowmass-Mountain" "Standard-Route"

# Windom Peak (14,082')
download 7003947 "Windom-Peak" "West-Ridge"

# Mount Eolus (14,083')
download 7011347 "Mount-Eolus" "Northeast-Ridge"

# Challenger Point (14,081')
download 7011409 "Challenger-Point" "North-Slopes"

# Mount Columbia (14,073')
download 7004372 "Mount-Columbia" "West-Slopes"

# Missouri Mountain (14,067')
download 7004363 "Missouri-Mountain" "Northwest-Ridge"

# Humboldt Peak (14,064')
download 7011410 "Humboldt-Peak" "West-Ridge"

# Mount Bierstadt (14,060')
download 7001739 "Mount-Bierstadt" "West-Slopes"

# Sunlight Peak (14,059')
download 7003947 "Sunlight-Peak" "Standard-Route"

# Handies Peak (14,048')
download 7003141 "Handies-Peak" "West-Slopes"

# Ellingwood Point (14,042')
download 7011440 "Ellingwood-Point" "Southwest-Face"

# Mount Lindsey (14,042')
download 7004848 "Mount-Lindsey" "North-Couloir"

# Culebra Peak (14,047')
download 7002204 "Culebra-Peak" "Southwest-Ridge"

# Mount Sherman (14,036')
download 7004196 "Mount-Sherman" "Southwest-Ridge"

# Little Bear Peak (14,037')
download 7011441 "Little-Bear-Peak" "West-Ridge"

# Redcloud Peak (14,034')
download 7003139 "Redcloud-Sunshine" "Standard-Route"

# Pyramid Peak (14,018')
download 7011177 "Pyramid-Peak" "Northeast-Ridge"

# San Luis Peak (14,014')
download 7003198 "San-Luis-Peak" "East-Slopes"

# North Maroon Peak (14,014')
download 7016498 "North-Maroon-Peak" "Northeast-Ridge"

# Wetterhorn Peak (14,015')
download 7003316 "Wetterhorn-Peak" "Southeast-Ridge"

# Wilson Peak (14,017')
download 7011269 "Wilson-Peak" "Standard-Route"

# Mount of the Holy Cross (14,005')
download 7004499 "Holy-Cross" "North-Ridge"

# Huron Peak (14,003')
download 7004353 "Huron-Peak" "Northwest-Slopes"

# Sunshine Peak (14,001')
download 7003139 "Sunshine-Peak" "Via-Redcloud"

# El Diente Peak (14,159')
download 7011270 "El-Diente-Peak" "Standard-Route"

# Mount Cameron (14,238')
download 7016497 "Mount-Cameron" "Via-Lincoln"

# Conundrum Peak (14,060')
download 7028862 "Conundrum-Peak" "Via-Castle"

# North Eolus (14,039')
download 7028863 "North-Eolus" "Standard-Route"

# Additional alternate routes
download 7003956 "Chicago-Basin" "14er-Grand-Slam"
download 7002237 "Grays-Torreys" "Sawtooth"

echo ""
echo "=== Done: $SUCCESS succeeded, $FAILED failed out of $TOTAL attempted ==="
