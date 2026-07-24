import React, { useState, useEffect, useRef, useContext } from 'react';
import {
  View, Text, FlatList, TextInput, Pressable,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppContext } from '../AppContext';
import { sendGroupMessage, getRoomMembers } from '../lib/RoomManager';
import { getRoomMessages } from '../lib/crdt';
import { colors, type, spacing, radii, shadow } from '../theme';
import { Avatar, Pill } from '../components/Basics';
import { IconBack, IconSend, IconRooms, IconLock } from '../icons/Icons';

const fmt = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export default function RoomChatScreen({ room, roomId, roomName, onBack }) {
  const actualRoomId = room?.id || roomId;
  const actualRoomName = room?.name || roomName;

  const { myId, myAlias, myEmoji } = useContext(AppContext);
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [members, setMembers] = useState([]);
  const listRef = useRef(null);

  useEffect(() => {
    loadMessages();
    setMembers(getRoomMembers(actualRoomId));
    const t = setInterval(loadMessages, 1200);
    return () => clearInterval(t);
  }, [actualRoomId]);

  async function loadMessages() {
    const msgs = await getRoomMessages(actualRoomId);
    setMessages(msgs);
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    setText('');
    await sendGroupMessage(actualRoomId, trimmed, myId, `${myEmoji} ${myAlias}`);
    await loadMessages();
    setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 80);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      style={[styles.container, { paddingTop: insets.top }]}
    >
      {/* WhatsApp Header */}
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.backBtn}>
          <IconBack size={20} color={colors.textPrimary} />
        </Pressable>

        <Avatar label={actualRoomName} size={38} tint={colors.signal} />

        <View style={{ marginLeft: spacing(2), flex: 1 }}>
          <Text style={[type.bodyMedium, { fontWeight: '700' }]} numberOfLines={1}>
            {actualRoomName}
          </Text>
          <View style={styles.statusRow}>
            <View style={styles.dot} />
            <Text style={[type.caption, { color: colors.textSecondary }]}>
              {members.length} members · Sender Keys active
            </Text>
          </View>
        </View>
      </View>

      {/* Messages */}
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m, i) => m.id || `msg_${i}`}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.listContent}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => {
          const isMine = item.from === myId;
          return (
            <View style={[styles.bubbleRow, { justifyContent: isMine ? 'flex-end' : 'flex-start' }]}>
              <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
                {!isMine && item.alias && (
                  <Text style={styles.senderAlias}>{item.alias}</Text>
                )}
                <Text style={[type.body, isMine ? styles.msgTextMine : styles.msgTextTheirs]}>
                  {item.text}
                </Text>
                <View style={styles.metaRow}>
                  <Text style={[type.caption, styles.timeText, isMine && styles.timeTextMine]}>
                    {fmt(item.ts)}
                  </Text>
                  {isMine && <Text style={[type.caption, { color: 'rgba(255,255,255,0.7)' }]}>✓✓</Text>}
                </View>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <IconRooms size={32} color={colors.textMuted} />
            <Text style={[type.caption, { marginTop: 10, textAlign: 'center', maxWidth: 240 }]}>
              Group messages are encrypted with sender keys distributed to active room members.
            </Text>
          </View>
        }
      />

      {/* Composer */}
      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Message room…"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          multiline
        />
        <Pressable
          style={[styles.sendBtn, text.trim().length > 0 && styles.sendBtnActive]}
          onPress={handleSend}
          disabled={!text.trim()}
        >
          <IconSend size={17} color={text.trim().length > 0 ? colors.bg : colors.textMuted} />
        </Pressable>
      </View>
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
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.signal,
  },
  listContent: {
    padding: 16,
    paddingBottom: 20,
    flexGrow: 1,
    justifyContent: 'flex-end',
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
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
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
});
