# SpaceMouse input

Settings provides an explicit **Connect SpaceMouse** action. The browser's device chooser grants permission; no HID input is opened automatically. A supported browser must expose WebHID in a secure context (HTTPS or localhost). Unsupported browsers show an unavailable status. The application does not install drivers or connect to a vendor/cloud service.

Supported report layouts cover SpaceNavigator, SpaceMouse Pro, Compact, Wireless, Pro Wireless and the Universal Receiver. An allowlist restricts product/vendor IDs. Signed six-axis reports drive camera-relative translation and rotation about the orbit pivot. Device buttons map to fit/isometric views when present. Settings adjust translation/rotation speed, deadzone, dominant-axis mode and rotation lock. These preferences are session-local.

Split and combined input layouts, invalid/truncated reports, button rising edges, stale-input expiry, disconnect and permission/open races are covered by synthetic HID tests. Camera tests cover translation, orbit radius, finite inputs and elapsed-time bounds. Physical-device axis direction, driver interaction, receiver routing and browser permission behavior require real hardware testing and have not been verified. An installed emulator does not prove a physical device works.

Motion expires after 150 milliseconds without fresh reports. Background pages ignore motion; animation stops when there is no input. Disconnect, page exit and component cleanup remove listeners and close only connections opened by this controller.

Protocol decisions use the public [WebHID specification](https://hid.spec.whatwg.org/) and [3dmouse-hid device report inventory](https://github.com/hcrlab/3dmouse-hid). The implementation is independently authored. Browser/OS policies can restrict access to devices; unknown devices are rejected rather than decoded speculatively.

The continuation validation adds a combined synthetic workflow from explicit HID selection/open through six-axis reports, camera movement, button callbacks, stale expiry and disposal. It verifies software routing and resource release, not physical hardware. The current Windows inventory only reported a KMJ emulator; no physical-device validation is claimed.
