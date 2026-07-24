import React, { useState, useEffect, useContext } from 'react';
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppContext } from '../AppContext';
import { addBulletin, getBulletin } from '../lib/crdt';
import {
  getIsAdmin,
  getAdminCount,
  becomeAdmin,
  isMasterAdminDevice,
} from '../lib/AdminKeyRegistry';
import {
  publishBroadcast,
  listBroadcasts,
} from '../lib/BroadcastManager';
import { connectToPeer } from '../lib/p2p';
import { colors, radii } from '../theme';
import { TopBar } from '../components/layout/TopBar';
import { Badge } from '../components/ui/Badge';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import {
  IconShieldCheck,
  IconMegaphone,
  IconSend,
  IconPlus,
} from '../icons/Icons';

const fmt = (t) => {
  if (!t) return '';
  const d = new Date(t);
  const now = new Date();
  const diffMins = Math.round((now - d) / 60000);
  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.round(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
};

export default function BulletinScreen({ navigation }) {
  const {
    myAlias,
    myPubKey,
    myId,
    peers,
    discoveredDevices,
    sendBulletin,
    messageTick,
    isAdmin,
    isMasterDevice: masterFromCtx,
  } = useContext(AppContext);
  const insets = useSafeAreaInsets();

  const [posts, setPosts] = useState([]);
  const [adminPosts, setAdminPosts] = useState([]);
  const [filter, setFilter] = useState('ALL'); // 'ALL' | 'URGENT' | 'RESOURCE' | 'INFO'
  const [text, setText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('INFO');
  const [isAdminUser, setIsAdminUser] = useState(isAdmin || getIsAdmin());
  const [adminCount, setAdminCount] = useState(0);
  const [isMasterDevice, setIsMasterDevice] = useState(masterFromCtx || false);

  useEffect(() => {
    isMasterAdminDevice().then((m) => setIsMasterDevice(m || masterFromCtx));
    loadAll();
    const t = setInterval(loadAll, 2000);
    return () => clearInterval(t);
  }, [messageTick, isAdmin, masterFromCtx]);

  async function loadAll() {
    const regular = await getBulletin();
    const broadcasts = await listBroadcasts();
    setPosts(regular || []);
    setAdminPosts(broadcasts || []);
    setIsAdminUser(getIsAdmin() || isAdmin);
    setAdminCount(getAdminCount());
  }

  async function handleClaimAdmin() {
    const isMaster = await isMasterAdminDevice();
    if (!isMaster) {
      Alert.alert('Restricted', 'Only the master physical hardware device (OZR8YXU44H4LX8X8) can claim Genesis Admin keys.');
      return;
    }

    Alert.alert(
      'Claim Genesis Admin',
      `Register "${myAlias || 'My Device'}" as the initial verified mesh administrator? You will sign official broadcasts with your ECDSA cryptographic key.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Become Admin',
          onPress: async () => {
            try {
              await becomeAdmin(myAlias || 'Admin', myPubKey || myId);
              setIsAdminUser(true);
              await loadAll();
              Alert.alert('Admin Active', 'You are now registered as Mesh Administrator.');
            } catch (e) {
              Alert.alert('Error', e.message);
            }
          },
        },
      ]
    );
  }

  async function handlePost() {
    if (!text.trim()) return;
    const body = text.trim();
    setText('');

    try {
      if (isAdminUser) {
        // Admin broadcast signed cryptographically
        await publishBroadcast(body, myAlias, myId, peers, selectedCategory);

        // Opportunistically connect to any discovered radio nodes not yet in peers so they receive it right away
        if (discoveredDevices && discoveredDevices.length > 0) {
          for (const d of discoveredDevices) {
            const epId = d.endpointId || d.deviceAddress;
            if (epId && !peers.has(epId)) {
              console.log(`[BulletinScreen] Connecting to discovered peer ${epId} to deliver broadcast`);
              connectToPeer(epId, myAlias).catch(() => {});
            }
          }
        }
      } else {
        // Regular mesh bulletin post
        if (sendBulletin) {
          await sendBulletin(body, selectedCategory);
        } else {
          await addBulletin({
            id: `post-${Date.now()}`,
            from: myId,
            alias: myAlias,
            text: body,
            category: selectedCategory,
            ts: Date.now(),
          });
        }
      }
      await loadAll();
    } catch (e) {
      console.warn('[BulletinScreen] handlePost error:', e);
      Alert.alert('Post Error', e.message || 'Failed to send post');
    }
  }

  // Combine and format posts
  const allPosts = [
    ...adminPosts.map((p) => ({
      ...p,
      verified: true,
      category: p.category || 'INFO',
      distance: 'Mesh Broadcast',
      content: p.body || p.text,
    })),
    ...posts.map((p) => ({
      ...p,
      verified: false,
      category: p.category || 'INFO',
      distance: 'Local Mesh',
      content: p.text || p.body,
    })),
  ].sort((a, b) => (b.ts || 0) - (a.ts || 0));

  const filteredPosts = allPosts.filter((p) => {
    if (filter === 'ALL') return true;
    return p.category === filter;
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      style={styles.container}
    >
      <TopBar
        title="Bulletin Board"
        subtitle="Network Notices & Evacuation Alerts"
        onMapPress={() => navigation?.navigate && navigation.navigate('Map')}
        rightAction={
          isAdminUser ? (
            <Badge variant="warning">★ ADMIN</Badge>
          ) : isMasterDevice ? (
            <Button
              size="sm"
              variant="default"
              onPress={handleClaimAdmin}
            >
              Claim Admin
            </Button>
          ) : (
            <Badge variant="outline">STANDARD NODE</Badge>
          )
        }
        onEmergencyPress={() => navigation?.navigate && navigation.navigate('Help')}
      />

      {/* Filter Tabs Bar (DML Signature) */}
      <View style={styles.filterBar}>
        {(['ALL', 'URGENT', 'RESOURCE', 'INFO']).map((f) => {
          const active = filter === f;
          return (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.filterChip, active && styles.filterChipActive]}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {f}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Official Channel Header Banner (For Standard Nodes) */}
      {!isAdminUser && (
        <View style={styles.topNoticeBanner}>
          <IconShieldCheck size={16} color={colors.amber} />
          <Text style={styles.topNoticeText}>
            Official Broadcast Channel • Announcements are published exclusively by Mesh Admins
          </Text>
        </View>
      )}

      {/* Posts List */}
      <FlatList
        data={filteredPosts}
        keyExtractor={(item, index) => item.id || `post-${index}`}
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1 }}
        contentContainerStyle={[styles.listContent, { paddingBottom: 20 }]}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => {
          const authorName = item.alias || item.author || 'Mesh User';
          return (
            <View style={styles.postCard}>
              <View style={styles.cardHeader}>
                <View style={styles.authorRow}>
                  <Avatar fallback={authorName} size="sm" tint={colors.amber} />
                  <View style={{ marginLeft: 10 }}>
                    <View style={styles.authorNameRow}>
                      <Text style={styles.authorName}>{authorName}</Text>
                      {item.verified && (
                        <View style={styles.verifiedIconWrap}>
                          <IconShieldCheck size={14} color={colors.amber} />
                        </View>
                      )}
                    </View>
                    <Text style={styles.postMeta}>
                      {fmt(item.ts)} • {item.distance || 'Local Mesh'}
                    </Text>
                  </View>
                </View>

                {item.category === 'URGENT' && (
                  <Badge variant="destructive">URGENT</Badge>
                )}
                {item.category === 'RESOURCE' && (
                  <Badge variant="success">RESOURCE</Badge>
                )}
                {item.category === 'INFO' && (
                  <Badge variant="secondary">INFO</Badge>
                )}
              </View>

              <Text style={styles.postContent}>{item.content}</Text>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <IconMegaphone size={40} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No announcements found</Text>
            <Text style={styles.emptySub}>
              {filter === 'ALL'
                ? 'Official signed announcements and community resources will appear here.'
                : `No notices categorized as ${filter}.`}
            </Text>
          </View>
        }
      />

      {/* Post Composer Bar */}
      {isAdminUser ? (
        <View style={styles.composer}>
          <View style={styles.categoryPickerRow}>
            {(['URGENT', 'RESOURCE', 'INFO']).map((cat) => (
              <Pressable
                key={cat}
                onPress={() => setSelectedCategory(cat)}
                style={[
                  styles.categoryPill,
                  selectedCategory === cat && styles.categoryPillActive,
                ]}
              >
                <Text
                  style={[
                    styles.categoryPillText,
                    selectedCategory === cat && styles.categoryPillTextActive,
                  ]}
                >
                  {cat}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Broadcast verified announcement to mesh..."
              placeholderTextColor={colors.textMuted}
              value={text}
              onChangeText={setText}
              multiline
            />
            <Pressable
              onPress={handlePost}
              disabled={!text.trim()}
              style={[styles.sendBtn, !text.trim() && styles.sendBtnDisabled]}
            >
              <IconSend size={16} color={colors.white} />
            </Pressable>
          </View>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
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
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
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
  listContent: {
    padding: 16,
    gap: 12,
  },
  postCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
    borderRadius: radii.lg,
    padding: 16,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 10,
  },
  authorNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  authorName: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  verifiedIconWrap: {
    marginTop: 1,
  },
  postMeta: {
    color: colors.textMuted,
    fontSize: 10.5,
    marginTop: 2,
  },
  postContent: {
    color: colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
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
  composer: {
    backgroundColor: 'rgba(9, 9, 11, 0.98)',
    borderTopWidth: 1,
    borderTopColor: colors.hairline,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 8,
  },
  categoryPickerRow: {
    flexDirection: 'row',
    gap: 8,
  },
  categoryPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  categoryPillActive: {
    backgroundColor: colors.amberDark,
    borderColor: colors.amberDark,
  },
  categoryPillText: {
    color: colors.textSecondary,
    fontSize: 10.5,
    fontWeight: '700',
  },
  categoryPillTextActive: {
    color: colors.white,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    color: colors.textPrimary,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 14,
    maxHeight: 80,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.amberDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  topNoticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(234, 179, 8, 0.08)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(234, 179, 8, 0.18)',
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  topNoticeText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: 11.5,
    fontWeight: '500',
    lineHeight: 16,
  },
});
