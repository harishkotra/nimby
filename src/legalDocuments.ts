export type LegalDocumentId = 'PrivacyPolicy' | 'TermsAndConditions';

type LegalDocument = {
  title: string;
  intro: string;
  sections: { heading: string; paragraphs: string[] }[];
};

export const legalContact = {
  email: 'reach@getnimby.com',
  location: 'Hyderabad, India',
  website: 'https://getnimby.com',
  showWebsite: process.env.EXPO_PUBLIC_NIMBY_SHOW_WEBSITE === '1',
};

export const legalUpdated = '22 November 2026';

export const legalDocuments: Record<LegalDocumentId, LegalDocument> = {
  PrivacyPolicy: {
    title: 'Privacy Policy',
    intro: 'This policy explains what Nimby accesses on your Android device, when it connects to other services, and how you can control your data.',
    sections: [
      { heading: 'Photos and your local index', paragraphs: [
        'You choose which photos Nimby can access through Android permissions or the system photo picker. Nimby analyzes those photos on your device. It keeps photo references, capture dates and album details, recognized text, tags, and numerical image representations in app storage to help you search and organize your gallery.',
        'Your photo contents, image analysis, saved choices, and personal collections stay on your device. Auto-scan, if enabled, checks for new or changed photos using the access you granted. Reminders and shopping suggestions are scheduled locally using Android notifications.',
      ] },
      { heading: 'Photo locations and voice', paragraphs: [
        'Photo locations are optional. With permission, Nimby reads coordinates already saved in your photos for the offline Photo Map and place searches.',
        'When you start a voice search, Nimby uses the microphone and transcribes speech on your device. Audio is held in memory for transcription. Optional voice and vision model downloads contact Moonshine and Hugging Face respectively to retrieve model files.',
      ] },
      { heading: 'Retailer search and external sites', paragraphs: [
        'When you open Find buying links, Nimby may contact its hosting service for the retailer search configuration. If you submit a hosted retailer search, the AWS-hosted lookup service and Tavily receive the edited search text. If you choose Google Shopping, Google receives the query you submit. The screenshot and its full recognized text stay on your device.',
        'Model hosts, search providers, and websites you open may receive standard connection details such as your IP address. Their handling and retention follow their own privacy policies. Some services may process requests outside India.',
      ] },
      { heading: 'Lifetime demo licenses', paragraphs: [
        'If you use the Lifetime demo, Dodo Payments handles the test checkout and the information you enter there. The app sends the license key and activation details to Dodo to activate, check, or release the license. Nimby stores the key and activation details in encrypted app storage. Payment card details are handled on the checkout page.',
      ] },
      { heading: 'Retention and your choices', paragraphs: [
        'Your index and preferences stay in local app storage until you clear them or remove the app. In Settings you can clear the analysis cache or delete local analysis metadata while keeping your original photos. You can manage or restore archived items in Archive.',
        'You can change photo and microphone permissions in Android settings, turn off Auto-scan and shopping notifications, and use Clear photo locations in Photo Map to remove indexed coordinates. Revoking gallery permission limits future access. Use the app’s data controls to remove the index it already made.',
        'If you contact us, we use your email address and any details you provide to respond and keep them as needed to handle your request or meet legal obligations. You can use the contact details below to ask about, correct, or delete information Nimby holds about you, or to raise a privacy concern.',
      ] },
    ],
  },
  TermsAndConditions: {
    title: 'Terms & Conditions',
    intro: 'These terms apply when you use Nimby to search and organize photos on your Android device.',
    sections: [
      { heading: 'Using Nimby', paragraphs: [
        'Use Nimby lawfully and only with photos and other content you have permission to access and process. Use hosted features within their limits and respect the rights and privacy of others.',
        'You retain your rights to your photos. When you grant access, Nimby uses the photos you allow to provide the features you choose. See the Privacy Policy for how Nimby handles that access and optional online services.',
      ] },
      { heading: 'Suggestions and third-party services', paragraphs: [
        'Photo classifications, search matches, grouped moments, and follow-up suggestions can be incomplete or mistaken. Check the original photo, retailer listing, and any dates before you act. Reminders are a convenience and Android may delay them.',
        'Retailer sites and optional services have their own terms, prices, and availability. Purchases made through a retailer link are between you and the retailer. Online features can be limited by provider availability or usage limits.',
      ] },
      { heading: 'Archive and deletion', paragraphs: [
        'Archiving hides a photo in Nimby while leaving the original in Android’s gallery. You can restore it from Archive. After 30 days, an item becomes eligible for a separate deletion review.',
        'Deleting an eligible original requires you to approve the action in Nimby and confirm it in Android. Deletion can be permanent. Check the selected files before approving and keep independent copies of important photos.',
      ] },
      { heading: 'Lifetime demo', paragraphs: [
        'The optional Lifetime demo uses simulated payments through Dodo Payments. Demo keys activate one installation at a time. To switch devices, release the old installation first. The demo license can be used offline for up to seven days after a successful check.',
      ] },
      { heading: 'Availability and your rights', paragraphs: [
        'Features may change or be unavailable from time to time. To the extent permitted by law, Nimby is provided as available and without a promise of uninterrupted service or error-free results. You retain the rights and remedies that applicable law gives you, including mandatory consumer protections.',
        'Updates to these terms will appear here with a new date. Use the contact details below for questions about the app or these terms.',
      ] },
    ],
  },
};
