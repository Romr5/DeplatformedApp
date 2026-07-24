# 📡 De-Platformed — Complete Project Documentation

> **Off-Grid, Zero-Internet P2P Mesh Messenger & Emergency Communication Network**  
> *Built for offline emergencies, disaster resilience, and censorship-resistant peer-to-peer messaging.*

---

## 🌟 Executive Summary

**De-Platformed** is an offline-first peer-to-peer communication system. It enables nearby mobile devices and web browsers to communicate directly over radio frequencies (**Bluetooth LE & Wi-Fi Direct**)—**without internet, cellular towers, SIM cards, or central servers**.

---

## 🏗️ Architecture & Platform Implementations

The project consists of two core builds:

```
                  ┌──────────────────────────────────────────────┐
                  │            De-Platformed Ecosystem           │
                  └──────────────────────┬───────────────────────┘
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 │                                               │
  ┌──────────────▼──────────────┐                 ┌──────────────▼──────────────┐
  │   1. Web App (PWA)          │                 │ 2. Native Android App       │
  │   c:\My Works\De-Platformed │                 │ c:\My Works\DeplatformedApp │
  ├─────────────────────────────┤                 ├─────────────────────────────┤
  │ - Node.js Express server    │                 │ - React Native + Hermes     │
  │ - Service Worker PWA        │                 │ - Google Nearby Connections │
  │ - WebRTC DataChannel        │                 │ - Native ECDH/AES Crypto    │
  │ - LocalStorage CRDT Queue   │                 │ - Standalone APK artifact   │
  └─────────────────────────────┘                 └─────────────────────────────┘
```

---

## 📦 Comprehensive Completed Features Inventory

### 1. 📶 100% Offline P2P Mesh Network (No Internet Required)
- **Engine:** Google Play Services **Nearby Connections API** (`play-services-nearby:19.3.0`).
- **Hardware Radios Used:** Bluetooth Low Energy (BLE) for instant discovery + Wi-Fi Direct / Hotspot for high-speed P2P data transfer.
- **Range:** Direct 100-meter line-of-sight per hop (expandable via mesh relaying).

### 2. 🛡️ Security, E2E Encryption & Pairing Prompts
- **Encryption:** Elliptic Curve Diffie-Hellman (ECDH P-256) key exchange + AES-256-GCM symmetric payload encryption (`react-native-quick-crypto`).
- **Pairing Approval Prompt:** When a new nearby device requests connection, a native alert pops up:
  > 📱 **P2P Pair Request**  
  > *"Alex's Phone" wants to connect to your offline mesh.*  
  > `[ Reject ❌ ]` &nbsp;&nbsp; `[ Accept & Trust ✅ ]`

### 3. 🔒 Trusted Device Memory & Auto-Reconnect
- **Persistent Memory:** Approved friends are saved in phone memory (`AsyncStorage`).
- **Instant Auto-Reconnect:** Previously trusted friends automatically reconnect when coming back nearby—**with zero permission prompts**.
- **Control:** Includes `🗑️ Unpair` and `🧹 Reset Saved Friends` controls to revoke trust anytime.

### 4. 💬 Multi-Peer Chat Modes: Group Mesh & Private 1-on-1
- **Group Mesh Chat:** Broadcast messages to all approved connected friends in your local mesh (emergency channel mode).
- **Private 1-on-1 Direct Chat:** Tap **`💬 Private`** next to any connected friend on the **Mesh 🕸️** screen to open a dedicated, encrypted 1-on-1 private chat room.

### 5. 🔄 Store-and-Forward CRDT Queue
- Messages sent while a friend is out of radio range are automatically queued in local storage (`crdt.js`) and flushed automatically the instant the friend comes back in range.

### 6. 📱 Standalone Native APK Package
- **Artifact Location:** [Deplatformed.apk](file:///c:/My%20Works/DeplatformedApp/Deplatformed.apk) (~218 MB).
- **Bundled Offline Assets:** Packaged offline JavaScript bundle (`index.android.bundle`) so the APK runs 100% standalone without needing Metro bundler or a PC connection.

---

## 🗺️ Future Expansion Roadmap

### 🚌 Option A: Transit Bundle Sync ("Data Mule" Mode)
* **Concept:** Inter-city offline message delivery via buses, trains, and delivery vehicles acting as "data mules" carrying encrypted bundle queues between disconnected cities.
* **Cost:** $0 (Pure software algorithm).

### 📻 Option B: LoRa / Meshtastic Long-Range Radio Hardware
* **Concept:** Plug-and-play integration with 915MHz / 868MHz LoRa radio modules (e.g., LilyGO T-Beam, Heltec V3).
* **Cost:** ~$20 per chip.
* **Range:** **10km to 50km** long-range radio coverage.

---

## 📂 Key Source Code Directories

| Component | File Path |
|---|---|
| **Compiled Android APK** | [Deplatformed.apk](file:///c:/My%20Works/DeplatformedApp/Deplatformed.apk) |
| **Android Native Module** | [NearbyModule.java](file:///c:/My%20Works/DeplatformedApp/android/app/src/main/java/com/anonymous/DeplatformedApp/NearbyModule.java) |
| **P2P Layer Driver** | [p2p.js](file:///c:/My%20Works/DeplatformedApp/src/lib/p2p.js) |
| **Global State & Trust Memory** | [AppContext.jsx](file:///c:/My%20Works/DeplatformedApp/src/AppContext.jsx) |
| **Peers & Mesh Screen** | [PeersScreen.jsx](file:///c:/My%20Works/DeplatformedApp/src/screens/PeersScreen.jsx) |
| **Group Chat Screen** | [ChatScreen.jsx](file:///c:/My%20Works/DeplatformedApp/src/screens/ChatScreen.jsx) |
| **Emergency Bulletin Board** | [BulletinScreen.jsx](file:///c:/My%20Works/DeplatformedApp/src/screens/BulletinScreen.jsx) |
| **Web PWA Implementation** | [server.js](file:///c:/My%20Works/De-Platformed/server.js) |

---

*Documentation updated & verified: July 2026*
