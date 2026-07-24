import React, { useState, useEffect, useContext, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  Modal,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppContext } from '../AppContext';
import { getPairedContacts, isPeerTrusted } from '../lib/ContactManager';
import { listRooms, createRoom } from '../lib/RoomManager';
import { getAdminBroadcasts, getLastDirectMessage, getLastRoomMessage, getAllDirectConversations } from '../lib/crdt';
import SettingsScreen from './SettingsScreen';
import { colors, radii } from '../theme';
import { TopBar } from '../components/layout/TopBar';
import { Badge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import {
  IconSearch,
  IconGear,
  IconPlus,
  IconCheckDouble,
  IconRooms,
  IconRadioTower,
  IconClose,
  IconLock,
  IconBroadcast,
} from '../icons/Icons';

const fmt = (t) => {
  if (!t) return '';
  const d = new Date(t);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export default function ConversationsScreen({ onSelectConversation, onNavigateToRadar, navigation }) {
  const { myId, myAlias, peers, messageTick } = useContext(AppContext);
  const insets = useSafeAreaInsets();

  const [filter, setFilter] = useState('all'); // 'all' | 'direct' | 'rooms' | 'broadcast'
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [broadcastSnippet, setBroadcastSnippet] = useState(null);
  const [showFabModal, setShowFabModal] = useState(false);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    loadAllConversations();
    const interval = setInterval(loadAllConversations, 2500);
    return () => clearInterval(interval);
  }, [peers, messageTick]);

  async function loadAllConversations() {
    // 1. Pinned official admin broadcast snippet
    const adminPosts = await getAdminBroadcasts();
    const lastBcast = adminPosts.length > 0 ? adminPosts[0] : null;
    setBroadcastSnippet(lastBcast);

    // 2. Direct 1:1 contacts & connected peers
    const paired = getPairedContacts ? getPairedContacts() : [];
    const directItems = [];
    const seenIds = new Set();

    for (const c of paired) {
      const cleanAlias = (c.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
      const pid = c.peerId || c.uuid;
      if (!pid || seenIds.has(pid) || (cleanAlias && seenIds.has(cleanAlias))) continue;
      seenIds.add(pid);
      if (c.uuid) seenIds.add(c.uuid);
      if (cleanAlias) seenIds.add(cleanAlias);

      // Find active connected endpoint
      let activeEndpoint = null;
      if (peers.has(c.peerId)) {
        activeEndpoint = c.peerId;
      } else {
        for (const [epId, p] of peers.entries()) {
          const pClean = (p.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
          if ((c.uuid && p.uuid === c.uuid) || (cleanAlias && pClean && cleanAlias === pClean)) {
            activeEndpoint = epId;
            break;
          }
        }
      }

      const isConnected = Boolean(activeEndpoint);
      const lastMsg = await getLastDirectMessage(activeEndpoint || c.peerId, myId, c.uuid);
      const rawTitle = c.alias || 'Direct Peer';
      const cleanTitle = rawTitle.replace(/^[\p{Emoji}\s]+/u, '').trim() || rawTitle;

      directItems.push({
        id: c.peerId || c.uuid,
        uuid: c.uuid,
        peerId: activeEndpoint || c.peerId,
        type: 'direct',
        title: cleanTitle,
        isConnected,
        isTrusted: true,
        lastMsgText: lastMsg ? lastMsg.text : 'Direct encrypted session ready',
        lastMsgTs: lastMsg ? lastMsg.ts : c.pairedAt || 0,
        lastMsgFromMe: lastMsg ? lastMsg.from === myId : false,
      });
    }

    for (const [peerId, peer] of peers.entries()) {
      const cleanAlias = (peer.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
      if (seenIds.has(peerId) || (peer.uuid && seenIds.has(peer.uuid)) || (cleanAlias && seenIds.has(cleanAlias))) continue;

      const lastMsg = await getLastDirectMessage(peerId, myId, peer.uuid);
      const isTrustedOrPaired = isPeerTrusted(peerId) || (peer.uuid && isPeerTrusted(peer.uuid)) || isPeerTrusted(cleanAlias);
      if (!lastMsg && !isTrustedOrPaired) continue;

      seenIds.add(peerId);
      if (peer.uuid) seenIds.add(peer.uuid);
      if (cleanAlias) seenIds.add(cleanAlias);

      const rawPeerTitle = peer.alias || 'Direct Peer';
      const cleanPeerTitle = rawPeerTitle.replace(/^[\p{Emoji}\s]+/u, '').trim() || rawPeerTitle;

      directItems.push({
        id: peer.uuid || peerId,
        peerId,
        uuid: peer.uuid,
        type: 'direct',
        title: cleanPeerTitle,
        isConnected: true,
        isTrusted: isTrustedOrPaired,
        lastMsgText: lastMsg ? lastMsg.text : 'Direct encrypted session ready',
        lastMsgTs: lastMsg ? lastMsg.ts : Date.now(),
        lastMsgFromMe: lastMsg ? lastMsg.from === myId : false,
      });
    }

    const storedConvs = await getAllDirectConversations(myId);
    for (const conv of storedConvs) {
      const cleanAlias = (conv.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
      if (seenIds.has(conv.peerId) || (conv.uuid && seenIds.has(conv.uuid)) || (cleanAlias && seenIds.has(cleanAlias))) continue;
      seenIds.add(conv.peerId);
      if (conv.uuid) seenIds.add(conv.uuid);
      if (cleanAlias) seenIds.add(cleanAlias);

      let isConnected = false;
      let connectedEndpointId = conv.peerId;
      if (peers.has(conv.peerId)) {
        isConnected = true;
      } else {
        for (const [epId, p] of peers.entries()) {
          const pClean = (p.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase();
          if (epId === conv.peerId || p.uuid === conv.peerId || (conv.uuid && p.uuid === conv.uuid) || (cleanAlias && pClean && cleanAlias === pClean)) {
            isConnected = true;
            connectedEndpointId = epId;
            break;
          }
        }
      }

      const rawConvTitle = conv.alias || 'Direct Peer';
      const cleanConvTitle = rawConvTitle.replace(/^[\p{Emoji}\s]+/u, '').trim() || rawConvTitle;

      directItems.push({
        id: conv.peerId,
        peerId: connectedEndpointId || conv.peerId,
        uuid: conv.uuid,
        type: 'direct',
        title: cleanConvTitle,
        isConnected,
        isTrusted: isPeerTrusted(conv.peerId) || (conv.uuid && isPeerTrusted(conv.uuid)),
        lastMsgText: conv.lastMsg ? conv.lastMsg.text : '',
        lastMsgTs: conv.lastMsg ? conv.lastMsg.ts : 0,
        lastMsgFromMe: conv.lastMsg ? conv.lastMsg.from === myId : false,
      });
    }

    // 3. Group Rooms
    const roomsList = listRooms ? listRooms() : [];
    const roomItems = [];
    for (const r of roomsList) {
      const lastMsg = await getLastRoomMessage(r.id);
      roomItems.push({
        id: r.id,
        type: 'room',
        title: r.name,
        membersCount: r.members ? r.members.length : 1,
        lastMsgText: lastMsg ? `${lastMsg.alias ? lastMsg.alias.split(' ')[0] + ': ' : ''}${lastMsg.text}` : 'Created group room',
        lastMsgTs: lastMsg ? lastMsg.ts : r.createdAt || 0,
        lastMsgFromMe: lastMsg ? lastMsg.from === myId : false,
      });
    }

    const all = [...directItems, ...roomItems].sort((a, b) => (b.lastMsgTs || 0) - (a.lastMsgTs || 0));
    setConversations(all);
  }

  async function handleCreateRoom() {
    if (!newRoomName.trim()) return;
    const name = newRoomName.trim();
    setNewRoomName('');
    setShowCreateRoom(false);
    try {
      const room = await createRoom(name, myId, myAlias);
      await loadAllConversations();
      if (room && onSelectConversation) {
        onSelectConversation({
          id: room.id,
          type: 'room',
          title: room.name,
          membersCount: 1,
        });
      }
    } catch (e) {
      console.warn('Failed to create room:', e);
    }
  }

  // Filter items
  const filteredList = useMemo(() => {
    let list = conversations;
    if (filter === 'direct') {
      list = list.filter((c) => c.type === 'direct');
    } else if (filter === 'rooms') {
      list = list.filter((c) => c.type === 'room');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((c) =>
        (c.title && c.title.toLowerCase().includes(q)) ||
        (c.lastMsgText && c.lastMsgText.toLowerCase().includes(q))
      );
    }
    return list;
  }, [conversations, filter, searchQuery]);

  return (
    <View style={styles.container}>
      <TopBar
        title="Chats"
        subtitle="End-to-End Encrypted Sessions"
        onMapPress={() => navigation?.navigate ? navigation.navigate('Map') : null}
        onEmergencyPress={() => navigation?.navigate ? navigation.navigate('Help') : null}
        rightAction={
          <View style={styles.topRightActions}>
            <Pressable
              onPress={() => setIsSearchOpen(!isSearchOpen)}
              style={styles.iconBtn}
              hitSlop={6}
            >
              <IconSearch size={18} color={isSearchOpen ? colors.amber : colors.textSecondary} />
            </Pressable>
            <Pressable
              onPress={() => setShowSettings(true)}
              style={styles.iconBtn}
              hitSlop={6}
            >
              <IconGear size={18} color={colors.textSecondary} />
            </Pressable>
          </View>
        }
      />

      {/* Search Input Bar (Expandable) */}
      {isSearchOpen && (
        <View style={styles.searchBarWrap}>
          <IconSearch size={16} color={colors.textMuted} style={{ marginLeft: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search chats or messages..."
            placeholderTextColor={colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
              <IconClose size={16} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
      )}

      {/* Filter Tabs / Pills */}
      <View style={styles.filterBar}>
        {[
          { key: 'all', label: 'ALL' },
          { key: 'direct', label: 'DIRECT' },
          { key: 'rooms', label: 'ROOMS' },
          { key: 'broadcast', label: 'BROADCAST' },
        ].map((item) => {
          const active = filter === item.key;
          return (
            <Pressable
              key={item.key}
              onPress={() => setFilter(item.key)}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Main Conversation Feed */}
      <FlatList
        data={filter === 'broadcast' ? [] : filteredList}
        keyExtractor={(item) => `${item.type}-${item.id}`}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 24) + 80 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          (filter === 'all' || filter === 'broadcast') ? (
            <Pressable
              style={styles.broadcastCard}
              onPress={() =>
                onSelectConversation({
                  type: 'broadcast',
                  id: 'global-mesh-broadcast',
                  title: 'Local Mesh Broadcast',
                })
              }
            >
              <Avatar fallback="📢" size="default" tint={colors.amber} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <View style={styles.rowTop}>
                  <Text style={styles.chatTitle}>Local Mesh Broadcast</Text>
                  <Text style={styles.timestampText}>
                    {broadcastSnippet ? fmt(broadcastSnippet.ts) : 'Live'}
                  </Text>
                </View>
                <View style={styles.rowBottom}>
                  <IconBroadcast size={13} color={colors.amber} />
                  <Text style={styles.lastMsgSnippet} numberOfLines={1}>
                    {broadcastSnippet
                      ? `${broadcastSnippet.alias ? broadcastSnippet.alias + ': ' : ''}${broadcastSnippet.text}`
                      : 'Public emergency radio broadcast channel (100m range)'}
                  </Text>
                  <Badge variant="warning">Broadcast</Badge>
                </View>
              </View>
            </Pressable>
          ) : null
        }
        renderItem={({ item }) => {
          const isGroup = item.type === 'room';
          return (
            <Pressable
              style={styles.chatRow}
              onPress={() => onSelectConversation(item)}
            >
              <Avatar
                fallback={item.title}
                size="default"
                tint={isGroup ? colors.signal : colors.amber}
              />
              <View style={styles.chatContent}>
                <View style={styles.rowTop}>
                  <Text style={styles.chatTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.timestampText}>{fmt(item.lastMsgTs)}</Text>
                </View>
                <View style={styles.rowBottom}>
                  <IconLock size={12} color={colors.amber} />
                  {item.lastMsgFromMe && (
                    <IconCheckDouble size={13} color={item.isConnected ? colors.signal : colors.textMuted} />
                  )}
                  <Text style={styles.lastMsgSnippet} numberOfLines={1}>
                    {item.lastMsgText || 'Tap to start conversation'}
                  </Text>
                  {isGroup ? (
                    <Badge variant="success">{item.membersCount || 1} members</Badge>
                  ) : item.isTrusted ? (
                    <Badge variant="outline">E2E</Badge>
                  ) : null}
                </View>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          filter !== 'broadcast' ? (
            <View style={styles.emptyWrap}>
              <IconRadioTower size={36} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>
                {filter === 'rooms' ? 'No group rooms created yet' : 'No direct conversations yet'}
              </Text>
              <Text style={styles.emptySub}>
                Discover nearby peers on the Mesh radar to pair and start messaging offline.
              </Text>
              <Button
                variant="outline"
                size="sm"
                onPress={onNavigateToRadar}
                style={{ marginTop: 12 }}
              >
                Scan Mesh Radar
              </Button>
            </View>
          ) : null
        }
      />

      {/* New Conversation / Room Modal */}
      <Modal
        visible={showFabModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowFabModal(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowFabModal(false)}>
          <View style={[styles.fabMenu, { paddingBottom: Math.max(insets.bottom, 20) }]}>
            <Text style={styles.fabMenuTitle}>START CONVERSATION</Text>

            <Pressable
              style={styles.fabMenuItem}
              onPress={() => {
                setShowFabModal(false);
                setShowCreateRoom(true);
              }}
            >
              <View style={[styles.fabMenuIcon, { backgroundColor: 'rgba(16, 185, 129, 0.15)' }]}>
                <IconRooms size={18} color={colors.signal} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fabItemTitle}>New Group Room</Text>
                <Text style={styles.fabItemSub}>Encrypted channel with multi-peer Sender Keys</Text>
              </View>
            </Pressable>

            <Pressable
              style={styles.fabMenuItem}
              onPress={() => {
                setShowFabModal(false);
                if (onNavigateToRadar) onNavigateToRadar();
              }}
            >
              <View style={[styles.fabMenuIcon, { backgroundColor: 'rgba(245, 158, 11, 0.15)' }]}>
                <IconRadioTower size={18} color={colors.amber} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.fabItemTitle}>Direct 1:1 Radio Chat</Text>
                <Text style={styles.fabItemSub}>Find and pair with nearby devices</Text>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Create Room Modal */}
      <Modal
        visible={showCreateRoom}
        transparent
        animationType="fade"
        onRequestClose={() => setShowCreateRoom(false)}
      >
        <Pressable style={styles.modalOverlay} onPress={() => setShowCreateRoom(false)}>
          <View style={styles.createRoomDialog}>
            <Text style={styles.createRoomTitle}>Create Group Room</Text>
            <Text style={styles.createRoomSub}>
              Members will exchange cryptographic Sender Keys for fast, confidential offline group chat.
            </Text>
            <TextInput
              style={styles.roomInput}
              placeholder="e.g. Neighborhood Patrol Alpha"
              placeholderTextColor={colors.textMuted}
              value={newRoomName}
              onChangeText={setNewRoomName}
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Button
                variant="outline"
                style={{ flex: 1 }}
                onPress={() => setShowCreateRoom(false)}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                style={{ flex: 1 }}
                onPress={handleCreateRoom}
              >
                Create
              </Button>
            </View>
          </View>
        </Pressable>
      </Modal>

      {/* Settings Modal */}
      <Modal
        visible={showSettings}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSettings(false)}
      >
        <SettingsScreen onBack={() => setShowSettings(false)} />
      </Modal>

      {/* Floating Action Button (WhatsApp Style) */}
      <Pressable
        style={[styles.floatingFab, { bottom: Math.max(insets.bottom, 12) + 76 }]}
        onPress={() => setShowFabModal(true)}
        hitSlop={8}
      >
        <IconPlus size={24} color={colors.white} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  topRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  floatingFab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.amberDark,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 8,
    zIndex: 99,
  },
  searchBarWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.md,
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 8,
    height: 40,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 13,
  },
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  filterChipActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  filterText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  filterTextActive: {
    color: colors.bg,
  },
  broadcastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.06)',
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  chatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(39, 39, 42, 0.6)',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  chatContent: {
    flex: 1,
    marginLeft: 12,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chatTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    paddingRight: 8,
  },
  timestampText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  lastMsgSnippet: {
    color: colors.textSecondary,
    fontSize: 13,
    flex: 1,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    color: colors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },
  emptySub: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
    maxWidth: 280,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'flex-end',
  },
  fabMenu: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    gap: 12,
  },
  fabMenuTitle: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  fabMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    padding: 14,
  },
  fabMenuIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabItemTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  fabItemSub: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
  createRoomDialog: {
    backgroundColor: colors.surface,
    margin: 20,
    marginBottom: 'auto',
    marginTop: 'auto',
    borderRadius: radii.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  createRoomTitle: {
    color: colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  createRoomSub: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 4,
    marginBottom: 14,
  },
  roomInput: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.md,
    color: colors.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
});
