import React, { useState, useEffect, useContext } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  Alert,
  ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppContext } from '../AppContext';
import {
  initRoomManager,
  createRoom,
  inviteMember,
  listRooms,
  getRoomMembers,
  leaveRoom,
} from '../lib/RoomManager';
import RoomChatScreen from './RoomChatScreen';
import { colors, radii } from '../theme';
import { TopBar } from '../components/layout/TopBar';
import { Badge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import {
  IconRooms,
  IconPeople,
  IconDoor,
  IconPlus,
  IconCheck,
} from '../icons/Icons';

export default function RoomsScreen({ navigation }) {
  const { myId, myAlias, myEmoji, peers, openConversation } = useContext(AppContext);
  const insets = useSafeAreaInsets();

  const [rooms, setRooms] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showInvite, setShowInvite] = useState(null);
  const [activeRoom, setActiveRoom] = useState(null);
  const [newRoomName, setNewRoomName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState(new Set());

  useEffect(() => {
    initRoomManager().then(refreshRooms);
    const t = setInterval(refreshRooms, 2000);
    return () => clearInterval(t);
  }, []);

  function refreshRooms() {
    setRooms(listRooms());
  }

  const seenMemberKeys = new Set();
  const connectedPeers = Array.from(peers.entries())
    .filter(([_, p]) => p.connected)
    .map(([id, p]) => ({ id, ...p }))
    .filter((p) => {
      const clean = (p.alias || '').replace(/^[\p{Emoji}\s]+/u, '').trim().toLowerCase() || p.uuid || p.id;
      if (seenMemberKeys.has(clean)) return false;
      seenMemberKeys.add(clean);
      return true;
    });

  function isPeerInRoom(room, p) {
    if (!room || !room.members || !p) return false;
    const pKey = p.endpointId || p.id;
    const pUUID = p.uuid || p.from;
    const cleanPAlias = (p.alias || '').trim().toLowerCase().replace(/^[^\w\s]+/, '').trim();

    return room.members.some((m) => {
      const mId = m.peerId || m.id;
      if (mId && (mId === pKey || mId === pUUID || mId === p.id || mId === p.endpointId)) {
        return true;
      }
      const cleanMAlias = (m.alias || '').trim().toLowerCase().replace(/^[^\w\s]+/, '').trim();
      return cleanPAlias && cleanMAlias && cleanPAlias === cleanMAlias;
    });
  }

  async function handleCreateRoom() {
    if (!newRoomName.trim()) return;
    const name = newRoomName.trim();
    const roomId = await createRoom(name, myId, `${myEmoji} ${myAlias}`);

    for (const peerKey of selectedMembers) {
      const p = connectedPeers.find((peer) => (peer.endpointId || peer.id) === peerKey);
      if (p) {
        await inviteMember(roomId, peerKey, p.alias, myId);
      }
    }

    setNewRoomName('');
    setSelectedMembers(new Set());
    setShowCreate(false);
    refreshRooms();
  }

  async function handleInvite(roomId, peerId, peerAlias) {
    const room = rooms.find((r) => r.id === roomId);
    if (room && isPeerInRoom(room, { id: peerId, endpointId: peerId, alias: peerAlias })) {
      Alert.alert('Already a Member', `${peerAlias || 'This person'} is already in this room.`);
      return;
    }
    const success = await inviteMember(roomId, peerId, peerAlias, myId);
    if (success === false) {
      Alert.alert('Already a Member', `${peerAlias || 'This person'} is already in this room.`);
      return;
    }
    refreshRooms();
    setShowInvite(null);
  }

  function handleLeave(roomId) {
    Alert.alert('Leave Room', 'Are you sure you want to leave this room?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          await leaveRoom(roomId, myId);
          refreshRooms();
        },
      },
    ]);
  }

  if (activeRoom) {
    return (
      <RoomChatScreen
        room={activeRoom}
        onBack={() => {
          setActiveRoom(null);
          refreshRooms();
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <TopBar
        title="Group Rooms"
        subtitle="Confidential Multi-Peer Sender Keys"
        onMapPress={() => navigation?.navigate && navigation.navigate('Map')}
        onEmergencyPress={() => navigation?.navigate && navigation.navigate('Help')}
      />

      <FlatList
        data={rooms}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: Math.max(insets.bottom, 24) + 80 }]}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const members = getRoomMembers(item.id);
          const memberCount = members.length;

          return (
            <Pressable
              style={styles.roomCard}
              onPress={() => {
                if (openConversation) {
                  openConversation({
                    id: item.id,
                    type: 'room',
                    title: item.name,
                    membersCount: memberCount,
                  });
                } else {
                  setActiveRoom(item);
                }
              }}
            >
              <Avatar fallback={item.name} size="default" tint={colors.signal} />
              <View style={styles.roomInfo}>
                <View style={styles.rowTop}>
                  <Text style={styles.roomName} numberOfLines={1}>{item.name}</Text>
                  <Badge variant="success">{memberCount} members</Badge>
                </View>
                <Text style={styles.cipherNote}>Protected with Ratcheting Sender Keys</Text>
              </View>

              <View style={styles.actionsRow}>
                <Pressable
                  style={styles.iconAction}
                  onPress={(e) => {
                    e.stopPropagation();
                    setShowInvite(item.id);
                  }}
                  hitSlop={8}
                >
                  <IconPlus size={16} color={colors.amber} />
                </Pressable>
                <Pressable
                  style={[styles.iconAction, styles.leaveAction]}
                  onPress={(e) => {
                    e.stopPropagation();
                    handleLeave(item.id);
                  }}
                  hitSlop={8}
                >
                  <IconDoor size={16} color={colors.danger} />
                </Pressable>
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <IconRooms size={44} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No group rooms created</Text>
            <Text style={styles.emptySub}>
              Create private group rooms with ratchet-based Sender Keys to broadcast to multiple peers at once.
            </Text>
            <Button
              variant="default"
              size="default"
              onPress={() => setShowCreate(true)}
              style={{ marginTop: 14 }}
            >
              Create Group Room
            </Button>
          </View>
        }
      />

      {/* Create Room Modal */}
      <Modal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Group Room"
      >
        <Text style={styles.modalSub}>
          Group communications are protected with ratcheting Sender Keys.
        </Text>

        <Text style={styles.inputLabel}>ROOM NAME</Text>
        <TextInput
          style={styles.input}
          value={newRoomName}
          onChangeText={setNewRoomName}
          placeholder="e.g. Operations Alpha"
          placeholderTextColor={colors.textMuted}
          autoFocus
        />

        {connectedPeers.length > 0 && (
          <>
            <Text style={styles.inputLabel}>INVITE NEARBY PEERS</Text>
            <ScrollView style={{ maxHeight: 150 }}>
              {connectedPeers.map((p) => {
                const isSelected = selectedMembers.has(p.id);
                return (
                  <Pressable
                    key={p.id}
                    style={[styles.peerSelectRow, isSelected && styles.peerSelectRowActive]}
                    onPress={() => {
                      const next = new Set(selectedMembers);
                      if (isSelected) next.delete(p.id);
                      else next.add(p.id);
                      setSelectedMembers(next);
                    }}
                  >
                    <Avatar fallback={p.alias || 'P'} size="sm" tint={colors.signal} />
                    <Text style={styles.peerAliasText}>{p.alias || 'Peer'}</Text>
                    {isSelected && <IconCheck size={16} color={colors.signal} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          <Button
            variant="outline"
            style={{ flex: 1 }}
            onPress={() => setShowCreate(false)}
          >
            Cancel
          </Button>
          <Button
            variant="default"
            style={{ flex: 1 }}
            disabled={!newRoomName.trim()}
            onPress={handleCreateRoom}
          >
            Create Room
          </Button>
        </View>
      </Modal>

      {/* Invite Modal */}
      <Modal
        isOpen={Boolean(showInvite)}
        onClose={() => setShowInvite(null)}
        title="Invite Member to Room"
      >
        <Text style={styles.modalSub}>
          Select a connected peer to securely distribute this room's cryptographic Sender Key.
        </Text>

        {connectedPeers.length === 0 ? (
          <View style={styles.emptyPeersBox}>
            <Text style={styles.emptyPeersText}>
              No active connected peers nearby to invite. Connect to peers in the Mesh tab first.
            </Text>
          </View>
        ) : (
          <ScrollView style={{ maxHeight: 220 }}>
            {connectedPeers.map((p) => {
              const currentRoom = rooms.find((r) => r.id === showInvite);
              const alreadyInRoom = currentRoom && isPeerInRoom(currentRoom, p);

              return (
                <View key={p.id} style={styles.inviteRow}>
                  <Avatar fallback={p.alias || 'P'} size="sm" tint={colors.signal} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.peerAliasText}>{p.alias || 'Peer'}</Text>
                    <Text style={styles.peerSubText}>Direct Radio Link Active</Text>
                  </View>
                  {alreadyInRoom ? (
                    <Badge variant="secondary">✓ Added</Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="default"
                      onPress={() => handleInvite(showInvite, p.endpointId || p.id, p.alias)}
                    >
                      Invite +
                    </Button>
                  )}
                </View>
              );
            })}
          </ScrollView>
        )}

        <Button
          variant="outline"
          style={{ marginTop: 14 }}
          onPress={() => setShowInvite(null)}
        >
          Close
        </Button>
      </Modal>

      {/* Floating Action Button (WhatsApp Style) */}
      <Pressable
        style={[styles.floatingFab, { bottom: Math.max(insets.bottom, 12) + 76 }]}
        onPress={() => setShowCreate(true)}
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
  listContent: {
    padding: 16,
    gap: 10,
  },
  roomCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.lg,
    padding: 14,
  },
  roomInfo: {
    flex: 1,
    marginLeft: 12,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  roomName: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
    paddingRight: 8,
  },
  cipherNote: {
    color: colors.textMuted,
    fontSize: 11,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 8,
  },
  iconAction: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveAction: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 70,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    color: colors.textSecondary,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 6,
  },
  emptySub: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
    maxWidth: 280,
  },
  modalSub: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 14,
  },
  inputLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: 6,
    marginTop: 10,
  },
  input: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    color: colors.textPrimary,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  peerSelectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    marginBottom: 6,
    gap: 10,
  },
  peerSelectRowActive: {
    borderWidth: 1,
    borderColor: colors.signal,
  },
  peerAliasText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  peerSubText: {
    color: colors.textMuted,
    fontSize: 11,
  },
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.hairline,
  },
  emptyPeersBox: {
    backgroundColor: colors.surfaceAlt,
    padding: 14,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  emptyPeersText: {
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
  },
});
