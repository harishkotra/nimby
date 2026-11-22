import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { legalContact, legalDocuments, legalUpdated, type LegalDocumentId } from './legalDocuments';
import { Body, color, ErrorText, Heading, Icon, styles } from './ui';

export function LegalDocumentScreen({ document }: { document: LegalDocumentId }) {
  const { title, intro, sections } = legalDocuments[document];
  const [error, setError] = useState('');

  async function openContact(url: string, failure: string) {
    setError('');
    try { await Linking.openURL(url); }
    catch { setError(failure); }
  }

  return <ScrollView contentContainerStyle={[styles.content, layout.content]}>
    <View style={layout.section}>
      <Heading large>{title}</Heading>
      <Body>Last updated {legalUpdated}</Body>
      <Text selectable style={layout.paragraph}>{intro}</Text>
    </View>
    {sections.map(({ heading, paragraphs }) => <View key={heading} style={layout.section}>
      <Heading>{heading}</Heading>
      {paragraphs.map((paragraph) => <Text key={paragraph} selectable style={layout.paragraph}>{paragraph}</Text>)}
    </View>)}
    <View style={layout.contact}>
      <Heading>Contact Nimby</Heading>
      <Body>{legalContact.location}</Body>
      <Pressable accessibilityRole="link" accessibilityLabel={`Email ${legalContact.email}`}
        onPress={() => void openContact(`mailto:${legalContact.email}`, 'Could not open your email app.')}
        style={({ pressed }) => [styles.textAction, pressed && styles.faded]}>
        <Text style={styles.link}>{legalContact.email}</Text>
        <Icon name="external" size={16} tint={color.blue} />
      </Pressable>
      {legalContact.showWebsite && <Pressable accessibilityRole="link" accessibilityLabel="Visit getnimby.com"
        onPress={() => void openContact(legalContact.website, 'Could not open the Nimby website.')}
        style={({ pressed }) => [styles.textAction, pressed && styles.faded]}>
        <Text style={styles.link}>getnimby.com</Text>
        <Icon name="external" size={16} tint={color.blue} />
      </Pressable>}
      {!!error && <ErrorText>{error}</ErrorText>}
    </View>
  </ScrollView>;
}

const layout = StyleSheet.create({
  content: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  section: { gap: 8 },
  paragraph: { color: color.lightText, fontSize: 16, lineHeight: 24 },
  contact: { backgroundColor: color.white, padding: 16, borderRadius: 16, gap: 4 },
});
