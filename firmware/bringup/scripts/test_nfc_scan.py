#!/usr/bin/env python3
"""Exercise the actual RFAL wait loops with deterministic host-side mocks."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / "src/backbone/nfc_svc.cpp").read_text()
loops = []
for label in ("detection", "collision"):
    start = source.index(f"    const uint32_t {label}_started_ms")
    end = source.index("    if (rc != ERR_NONE", start)
    loops.append(source[start:end])

prefix = r'''
#include <cassert>
#include <cstdint>
#include <vector>
constexpr int ERR_NONE=0, ERR_BUSY=2, ERR_IO=3, ERR_TIMEOUT=4;
uint32_t ticks=0;
uint32_t millis() { return ticks; }
void delay(int n) { ticks+=n; }
struct RF { void rfalWorker() {} } s_rf;
struct NFC {
    std::vector<int> replies;
    unsigned calls=0;
    int next() { unsigned i=calls++; return replies[i < replies.size() ? i : replies.size()-1]; }
    int rfalNfcaPollerGetTechnologyDetectionStatus() { return next(); }
    int rfalNfcaPollerGetFullCollisionResolutionStatus() { return next(); }
} s_nfc;
'''
program = prefix
for i, loop in enumerate(loops):
    program += f"int wait{i}(int rc) {{\n{loop}\nreturn rc;\n}}\n"
program += r'''
int main() {
    for (auto wait : {wait0, wait1}) {
        ticks=0; s_nfc={{ERR_BUSY,ERR_BUSY,ERR_NONE},0};
        assert(wait(ERR_NONE)==ERR_NONE && s_nfc.calls==3);
        ticks=0; s_nfc={{ERR_BUSY,ERR_IO},0};
        assert(wait(ERR_NONE)==ERR_IO && s_nfc.calls==2);
        ticks=0; s_nfc={{ERR_BUSY},0};
        assert(wait(ERR_NONE)==ERR_TIMEOUT && ticks>=300 && ticks<=750);
        ticks=0; s_nfc={{ERR_NONE},0};
        assert(wait(ERR_IO)==ERR_IO && s_nfc.calls==0);
    }
}
'''
with tempfile.TemporaryDirectory() as directory:
    cpp = Path(directory) / "wait.cpp"
    binary = Path(directory) / "wait"
    cpp.write_text(program)
    subprocess.run(["c++", "-std=c++14", str(cpp), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)

spec = importlib.util.spec_from_file_location("core_util", ROOT / "scripts/core_util.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
client = module.CoreClient.__new__(module.CoreClient)
client.nfc = lambda *args, **kwargs: {"ok": False, "status": 1,
                                    "data": bytes([1, 4, 2, 0xD1, 0, 0])}
result = client.nfc_scan(1)
assert result["rfal_error_name"] == "ERR_TIMEOUT"
assert result["stage"].startswith("technology detection")
client.nfc = lambda *args, **kwargs: {"ok": False, "status": 1, "data": bytes(6)}
assert "did not provide" in client.nfc_scan(1)["result"]
client.nfc = lambda *args, **kwargs: {"ok": False, "status": 255,
                                    "detail": "no NFC response from C3"}
assert client.nfc_scan(1)["result"] == "no NFC response from C3"
print("NFC wait-loop and scan diagnostic tests passed")

for flags, rc, bits, expected in (
    (3, 4, 0, "TX completed; RX timed out"),
    (5, 4, 0, "Software deadline expired"),
    (3, 0, 16, "ATQA received"),
    (3, 0, 8, "RFAL exchange failed or incomplete"),
):
    client.nfc = lambda *args, **kwargs: {"ok": True, "data": bytes([0xD2, flags, rc, bits, 0x44, 0])}
    result = client.nfc_probe(1)
    assert result["result"] == expected
    assert result["atqa_valid"] == (expected == "ATQA received")
client.nfc = lambda *args, **kwargs: {"ok": False, "status": 1, "data": bytes(6)}
try:
    client.nfc_probe(1)
except module.FlashError:
    pass
else:
    raise AssertionError("Legacy firmware was accepted as a diagnostic response")
print("NFC raw probe decoding tests passed")
