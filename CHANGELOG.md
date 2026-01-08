# Changelog

## 1.0.20

- Added `--path` (alias `-p`) argument to restrict search to a specific directory (Fixed #7)
- Fixed crash where the scanner threw an error if no files matched the query (e.g. complex queries or Chinese characters) (Fixed #2)
- Fixed `ERR_REQUIRE_ESM` crash on startup by downgrading `chalk` to v4 for CommonJS compatibility (Fixed #8, #1)
