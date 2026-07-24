import React, { useContext, useEffect } from 'react';
import { View, StyleSheet } from 'react-native';
import { AppContext } from '../AppContext';
import ConversationsScreen from './ConversationsScreen';
import ChatThreadScreen from './ChatThreadScreen';
import { colors } from '../theme';

export default function ChatScreen({ navigation }) {
  const {
    activeConversation,
    openConversation,
    closeConversation,
    tabNavigationRef,
  } = useContext(AppContext);

  useEffect(() => {
    if (tabNavigationRef) {
      tabNavigationRef.current = navigation;
    }
  }, [navigation, tabNavigationRef]);

  return (
    <View style={s.container}>
      {activeConversation ? (
        <ChatThreadScreen
          conversation={activeConversation}
          onBack={closeConversation}
        />
      ) : (
        <ConversationsScreen
          navigation={navigation}
          onSelectConversation={openConversation}
          onNavigateToRadar={() => navigation?.navigate && navigation.navigate('Mesh')}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
});
