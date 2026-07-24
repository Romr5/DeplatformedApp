import React, { useState, useEffect, useRef, useContext } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable,
  StyleSheet, KeyboardAvoidingView, Platform, Modal, Alert, Keyboard, BackHandler,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppContext } from '../AppContext';
import { getAdminBroadcasts, getDirectMessages, getRoomMessages, clearDirectMessages } from '../lib/crdt';
import { sendGroupMessage, getRoomMembers, leaveRoom } from '../lib/RoomManager';
import { publishBroadcast } from '../lib/BroadcastManager';
import { getIsAdmin } from '../lib/AdminKeyRegistry';
import { disconnectPeer, connectToPeer } from '../lib/p2p';
import { colors, type, spacing, radii, shadow } from '../theme';
import { Avatar, StatusDot, Pill } from '../components/Basics';
import {
  IconBack, IconSend, IconCheckDouble, IconBox, IconLock,
  IconShield, IconDoor, IconTrash, IconGear, IconClose,
} from '../icons/Icons';

const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDate = (t) => {
  const d = new Date(t);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'TODAY';
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'YESTERDAY';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }).toUpperCase();
};

export default function ChatThreadScreen({ conversation, onBack }) {
  const {
    myId, myAlias, myEmoji, peers, discoveredDevices, sendChatMessage,
    messageTick, unpairPeer, revokePairing, removeTrustedPeer, isPeerTrusted, isPaired,
  } = useContext(AppContext);
  const insets = useSafeAreaInsets();

  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [showInfo, setShowInfo] = useState(false);
  const [roomMembers, setRoomMembers] = useState([]);
  const listRef = useRef(null);

  const isDirect = conversation.type === 'direct';
  const isRoom = conversation.type === 'room';
  const isBroadcast = conversation.type === 'broadcast';

  const targetPeerId = conversation.peerId || conversation.id;
  const targetUUID = conversation.uuid || conversation.peer?.uuid;
  const cleanTargetAlias = (conversation.title || conversation.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();

  // Dynamically resolve currently active connected endpoint from peers (handles new endpoint IDs on reconnect!)
  let activeEndpointId = null;
  if (targetPeerId && peers.has(targetPeerId)) {
    activeEndpointId = targetPeerId;
  } else {
    for (const [epId, p] of peers.entries()) {
      const pClean = (p.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
      if ((targetUUID && p.uuid && p.uuid === targetUUID) || (cleanTargetAlias && pClean && cleanTargetAlias === pClean)) {
        activeEndpointId = epId;
        break;
      }
    }
  }

  const effectivePeerId = activeEndpointId || targetPeerId;
  const isDirectlyConnected = Boolean(activeEndpointId);

  useEffect(() => {
    loadMessages();
    if (isRoom) {
      setRoomMembers(getRoomMembers(conversation.id));
    }
  }, [conversation, messageTick]);

  useEffect(() => {
    const onBackPress = () => {
      onBack();
      return true;
    };
    const backSub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backSub.remove();
  }, [onBack]);

  useEffect(() => {
    const timer = setInterval(loadMessages, 1200);
    const onKeyboardShow = () => {
      setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: true });
      }, 80);
    };
    const subShow = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      onKeyboardShow
    );
    return () => {
      clearInterval(timer);
      subShow.remove();
    };
  }, [conversation]);

  async function loadMessages() {
    if (isBroadcast) {
      const msgs = await getAdminBroadcasts();
      setMessages(msgs);
    } else if (isDirect) {
      const msgs = await getDirectMessages(targetPeerId, myId, targetUUID, conversation.title);
      setMessages(msgs);
    } else if (isRoom) {
      const msgs = await getRoomMessages(conversation.id);
      setMessages(msgs);
    }
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');

    if (isBroadcast) {
      if (!getIsAdmin()) {
        Alert.alert('Restricted', 'Only verified Mesh Administrators can broadcast announcements to all devices.');
        return;
      }
      await publishBroadcast(trimmed, `${myEmoji} ${myAlias}`, myId, peers);
      if (discoveredDevices && discoveredDevices.length > 0) {
        for (const d of discoveredDevices) {
          const epId = d.endpointId || d.deviceAddress;
          if (epId && !peers.has(epId)) {
            console.log(`[ChatThreadScreen] Connecting to discovered peer ${epId} to deliver broadcast`);
            connectToPeer(epId, myAlias).catch(() => {});
          }
        }
      }
    } else if (isDirect) {
      if (isPaired && !isPaired(targetPeerId) && !isPaired(targetUUID) && !isPaired(conversation.title)) {
        Alert.alert('Not Paired', `You are not paired with ${conversation.title}. Send a pairing request from the Mesh screen to message.`);
        return;
      }
      await sendChatMessage(trimmed, targetUUID || targetPeerId, conversation.title);
    } else if (isRoom) {
      await sendGroupMessage(conversation.id, trimmed, myId, `${myEmoji} ${myAlias}`);
    }

    await loadMessages();
    setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 100);
  }

  function handleDisconnect() {
    Alert.alert(
      'Disconnect Radio',
      `Disconnect direct radio link with ${conversation.title}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            if (effectivePeerId) await disconnectPeer(effectivePeerId);
            else if (targetPeerId) await disconnectPeer(targetPeerId);
            setShowInfo(false);
          },
        },
      ]
    );
  }

  function handleUnpair() {
    Alert.alert(
      'Unpair Contact',
      `Revoke trust and remove ${conversation.title} from paired contacts?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpair & Revoke',
          style: 'destructive',
          onPress: async () => {
            try {
              await clearDirectMessages(targetPeerId, myId, targetUUID);
            } catch {}
            if (unpairPeer) {
              await unpairPeer(targetPeerId, targetUUID, conversation.title);
            } else {
              if (targetPeerId) await revokePairing(targetPeerId);
              if (targetUUID) await revokePairing(targetUUID);
            }
            setShowInfo(false);
            onBack();
          },
        },
      ]
    );
  }

  function handleLeaveRoom() {
    Alert.alert(
      'Leave Room',
      `Leave group room "${conversation.title}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            await leaveRoom(conversation.id, myId);
            setShowInfo(false);
            onBack();
          },
        },
      ]
    );
  }

  const amAdmin = getIsAdmin();
  let subtitleText = '';
  let statusOnline = false;
  if (isBroadcast) {
    subtitleText = amAdmin ? 'Administrator mode · Official Broadcasts' : 'Verified Admin Channel · Read-Only';
    statusOnline = true;
  } else if (isDirect) {
    if (isDirectlyConnected) {
      subtitleText = 'Direct radio link · E2E Double Ratchet';
      statusOnline = true;
    } else {
      subtitleText = 'Out of range · store & forward active';
      statusOnline = false;
    }
  } else if (isRoom) {
    subtitleText = `${roomMembers.length || conversation.membersCount || 1} members · Sender Keys active`;
    statusOnline = true;
  }

  function renderMessage({ item, index }) {
    const isMine = item.from === myId;
    const isSys = item.type === 'system';

    const prevMsg = index > 0 ? messages[index - 1] : null;
    const showDate = !prevMsg || fmtDate(prevMsg.ts) !== fmtDate(item.ts);

    if (isSys) {
      return (
        <View style={styles.sysRow}>
          <View style={styles.sysChip}>
            <Text style={styles.sysText}>{item.text}</Text>
          </View>
        </View>
      );
    }

    return (
      <View>
        {showDate && (
          <View style={styles.dayMarkerWrap}>
            <Text style={styles.dayMarker}>{fmtDate(item.ts)}</Text>
          </View>
        )}

        <View style={[styles.bubbleRow, { justifyContent: isMine ? 'flex-end' : 'flex-start' }]}>
          <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
            {!isMine && isRoom && item.alias && (
              <Text style={styles.senderAlias}>{item.alias}</Text>
            )}
            <Text style={[type.body, isMine ? styles.msgTextMine : styles.msgTextTheirs]}>
              {item.text}
            </Text>
            <View style={styles.metaRow}>
              <Text style={[type.caption, styles.timeText, isMine && styles.timeTextMine]}>
                {fmt(item.ts)}
              </Text>
              {isMine && (
                <IconCheckDouble
                  size={12}
                  color={isDirectlyConnected ? colors.signal : colors.bgElevated}
                />
              )}
            </View>
          </View>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      style={[styles.container, { paddingTop: insets.top }]}
    >
      {/* WhatsApp-Style Header */}
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <IconBack size={20} color={colors.textPrimary} />
        </Pressable>

        <View style={{ position: 'relative' }}>
          <Avatar
            label={conversation.title}
            size={38}
            tint={isBroadcast ? colors.warning : isRoom ? colors.signal : colors.ember}
          />
          {isDirect && <StatusDot online={statusOnline} />}
        </View>

        <View style={{ marginLeft: spacing(2), flex: 1 }}>
          <Text style={[type.bodyMedium, { fontWeight: '700' }]} numberOfLines={1}>
            {conversation.title}
          </Text>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.dot,
                { backgroundColor: statusOnline ? colors.signal : colors.textMuted },
              ]}
            />
            <Text style={[type.caption, { color: colors.textSecondary }]} numberOfLines={1}>
              {subtitleText}
            </Text>
          </View>
        </View>

        <Pressable
          style={styles.infoBtn}
          onPress={() => setShowInfo(true)}
        >
          <IconGear size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* Store and Forward Offline Banner */}
      {isDirect && !isDirectlyConnected && (
        <View style={styles.banner}>
          <IconBox size={16} color={colors.warning} />
          <Text style={[type.caption, { flex: 1, color: '#D8B378' }]}>
            Peer is out of radio range. Messages queue locally and deliver automatically when back in range.
          </Text>
        </View>
      )}

      {/* Message List */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id || `${m.ts}_${m.from}`}
        renderItem={renderMessage}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        ListEmptyComponent={
          <View style={styles.emptyFeed}>
            <IconLock size={28} color={colors.textMuted} />
            <Text style={[type.caption, { marginTop: 10, textAlign: 'center', maxWidth: 260 }]}>
              {isBroadcast
                ? 'Official signed broadcast channel.'
                : 'Messages are encrypted end-to-end directly over radio.'}
            </Text>
          </View>
        }
      />

      {/* Composer Row */}
      {isBroadcast && !amAdmin ? (
        <View style={[styles.readOnlyFooter, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <IconShield size={16} color={colors.warning} />
          <Text style={[type.caption, { color: colors.warning }]}>
            Broadcast channel is read-only. Only verified administrators can publish.
          </Text>
        </View>
      ) : (
        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Message securely…"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            multiline
            maxLength={1000}
          />
          <Pressable
            style={[styles.sendBtn, text.trim().length > 0 && styles.sendBtnActive]}
            onPress={handleSend}
            disabled={!text.trim()}
          >
            <IconSend
              size={17}
              color={text.trim().length > 0 ? colors.bg : colors.textMuted}
            />
          </Pressable>
        </View>
      )}

      {/* Info / Settings Modal */}
      <Modal
        visible={showInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowInfo(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowInfo(false)}>
          <Pressable style={styles.sheet} onPress={e => e.stopPropagation()}>
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={type.h2}>{conversation.title}</Text>
                <Text style={type.caption}>{subtitleText}</Text>
              </View>
              <Pressable onPress={() => setShowInfo(false)}>
                <IconClose size={20} color={colors.textMuted} />
              </Pressable>
            </View>

            {isDirect && (
              <View style={styles.infoSection}>
                <Text style={type.label}>DEVICE DETAILS</Text>
                <View style={styles.infoRow}>
                  <Text style={type.caption}>Radio Status:</Text>
                  <Pill tone={isDirectlyConnected ? 'signal' : 'default'} dot>
                    {isDirectlyConnected ? 'Connected (Nearby)' : 'Out of range'}
                  </Pill>
                </View>
                {targetUUID ? (
                  <View style={styles.infoRow}>
                    <Text style={type.caption}>Device UUID:</Text>
                    <Text style={type.mono}>{targetUUID.substring(0, 16)}…</Text>
                  </View>
                ) : null}

                <View style={styles.actionButtonsCol}>
                  {isDirectlyConnected && (
                    <Pressable style={styles.actionRowBtn} onPress={handleDisconnect}>
                      <IconDoor size={16} color={colors.warning} />
                      <Text style={[type.bodyMedium, { color: colors.warning, fontSize: 14 }]}>
                        Disconnect Radio Link
                      </Text>
                    </Pressable>
                  )}
                  <Pressable style={[styles.actionRowBtn, styles.dangerBtn]} onPress={handleUnpair}>
                    <IconTrash size={16} color={colors.danger} />
                    <Text style={[type.bodyMedium, { color: colors.danger, fontSize: 14 }]}>
                      Unpair & Revoke Trust
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}

            {isRoom && (
              <View style={styles.infoSection}>
                <Text style={type.label}>MEMBERS ({roomMembers.length})</Text>
                <View style={styles.membersList}>
                  {roomMembers.map((m, idx) => (
                    <View key={idx} style={styles.memberRow}>
                      <Avatar label={m.alias || 'M'} size={28} tint={colors.signal} />
                      <Text style={[type.bodyMedium, { flex: 1, fontSize: 14 }]}>
                        {m.alias || 'Peer'} {m.id === myId ? '(You)' : ''}
                      </Text>
                      {m.isAdmin && <Pill tone="ember">Admin</Pill>}
                    </View>
                  ))}
                </View>

                <Pressable style={[styles.actionRowBtn, styles.dangerBtn, { marginTop: 14 }]} onPress={handleLeaveRoom}>
                  <IconDoor size={16} color={colors.danger} />
                  <Text style={[type.bodyMedium, { color: colors.danger, fontSize: 14 }]}>
                    Leave Group Room
                  </Text>
                </Pressable>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    backgroundColor: colors.bgElevated,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  infoBtn: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  banner: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: colors.warningDim,
    padding: 12,
    paddingHorizontal: 16,
  },
  listContent: {
    padding: 16,
    paddingBottom: 20,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  emptyFeed: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 50,
  },
  dayMarkerWrap: {
    alignItems: 'center',
    marginVertical: 14,
  },
  dayMarker: {
    ...type.caption,
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: radii.pill,
    letterSpacing: 0.5,
  },
  bubbleRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  bubble: {
    maxWidth: '78%',
    flexShrink: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 16,
  },
  bubbleMine: {
    backgroundColor: colors.ember,
    borderBottomRightRadius: 3,
  },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderBottomLeftRadius: 3,
  },
  msgTextMine: {
    color: colors.white,
    fontSize: 15,
    lineHeight: 22,
    flexWrap: 'wrap',
  },
  msgTextTheirs: {
    color: colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
    flexWrap: 'wrap',
  },
  senderAlias: {
    ...type.caption,
    fontSize: 11.5,
    fontWeight: '700',
    color: colors.signal,
    marginBottom: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 3,
  },
  timeText: {
    fontSize: 10.5,
    color: colors.textSecondary,
  },
  timeTextMine: {
    color: 'rgba(255, 255, 255, 0.75)',
  },
  sysRow: {
    alignItems: 'center',
    marginVertical: 8,
  },
  sysChip: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radii.pill,
  },
  sysText: {
    ...type.caption,
    fontSize: 11,
    color: colors.textMuted,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    backgroundColor: colors.bgElevated,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radii.pill,
    fontSize: 15,
    maxHeight: 100,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnActive: {
    backgroundColor: colors.ember,
    ...shadow.glow(colors.ember),
  },
  readOnlyFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 14,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: 22,
    borderTopWidth: 1,
    borderColor: colors.hairline,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  infoSection: {
    gap: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  actionButtonsCol: {
    marginTop: 16,
    gap: 10,
  },
  actionRowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surfaceAlt,
    padding: 14,
    borderRadius: radii.md,
  },
  dangerBtn: {
    backgroundColor: colors.dangerDim,
  },
  membersList: {
    gap: 8,
    marginTop: 6,
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surfaceAlt,
    padding: 10,
    borderRadius: radii.md,
  },
});
