import React, { useState, useRef, useEffect } from 'react';
import { Image, Send, Loader2, Camera, Upload, X, ChevronDown } from 'lucide-react';

// Component to format markdown-like text
const FormattedMessage: React.FC<{ message: string }> = ({ message }) => {
  const formatText = (text: string) => {
    // Split text by paragraphs
    const paragraphs = text.split('\n\n');
    
    return paragraphs.map((paragraph, pIndex) => {
      if (!paragraph.trim()) return null;
      
      // Process each paragraph for inline formatting
      let formattedParagraph = paragraph
        // Bold text: **text** or __text__
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.*?)__/g, '<strong>$1</strong>')
        // Italic text: *text* or _text_
        .replace(/\*((?!\s).*?(?<!\s))\*/g, '<em>$1</em>')
        .replace(/_((?!\s).*?(?<!\s))_/g, '<em>$1</em>')
        // Line breaks within paragraphs
        .replace(/\n/g, '<br />');
      
      // Handle bullet points
      if (paragraph.includes('•') || paragraph.includes('-') || /^\d+\./.test(paragraph.trim())) {
        const lines = paragraph.split('\n').map(line => line.trim()).filter(line => line);
        const listItems = lines.map((line, lIndex) => {
          // Remove bullet markers and format
          let cleanLine = line
            .replace(/^[•\-]\s*/, '')
            .replace(/^\d+\.\s*/, '')
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*((?!\s).*?(?<!\s))\*/g, '<em>$1</em>');
          
          return (
            <li 
              key={lIndex} 
              className="mb-1"
              dangerouslySetInnerHTML={{ __html: cleanLine }}
            />
          );
        });
        
        return (
          <ul key={pIndex} className="list-disc list-inside mb-3 space-y-1">
            {listItems}
          </ul>
        );
      }
      
      return (
        <p 
          key={pIndex}
          className="mb-3 last:mb-0"
          dangerouslySetInnerHTML={{ __html: formattedParagraph }}
        />
      );
    }).filter(Boolean);
  };

  return <div>{formatText(message)}</div>;
};

interface ChatMessage {
  id: string;
  type: 'user' | 'bot';
  message?: string;
  image?: string;
  timestamp: Date;
  isProcessing?: boolean;
  showSuggestions?: boolean;
}

const functionUrl = import.meta.env.VITE_CLOUD_FUNCTION_URL;

type GeminiResponse = {
  message: string;
};

// Predefined question categories
const QUESTION_CATEGORIES = {
  ingredients: [
    "List the top five ingredients in this product.",
    "What are the five main nutrients in this food?",
    "Does this product contain any additives?",
    "Highlight all additives in this ingredient list.",
    "List all allergens found in this product."
  ],
  nutrition: [
    "How much sugar does this product contain?",
    "How much fat is in this product?",
    "How much protein is in this product?",
    "How much dietary fiber does it contain?",
    "What's the salt (sodium) content in this food?"
  ],
  additives: [
    "Does this product contain any added flavoring?",
    "Does it have any added coloring?",
    "Are there any artificial chemicals in this product?",
    "Are all the additives used in this product permitted under Malaysian food regulations?",
    "Does this food contain MSG (monosodium glutamate)?"
  ],
  vitamins: [
    "Does this product provide any vitamins?",
    "Does it contain any minerals?",
    "Is there caffeine in this product?"
  ],
  allergens: [
    "Does this product contain soy?",
    "Does this product contain egg?",
    "Alert me if this product contains any allergens.",
    "Alert me if the salt level is too high.",
    "Alert me if the sugar content is too high."
  ],
  interpretation: [
    "I can't read the small label — can you help me read it?",
    "Help me understand the nutrition label on this product."
  ]
};

const Chat: React.FC = () => {
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      type: 'bot',
      message: "Hi! I'm your food regulation assistant for Malaysia. Please upload a photo of a nutrition label to get started. 📷",
      timestamp: new Date()
    }
  ]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [lastUploadedImage, setLastUploadedImage] = useState<File | null>(null);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [showImageDropdown, setShowImageDropdown] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowImageDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Function to generate relevant questions based on AI response
  const generateSuggestedQuestions = (aiResponse: string): string[] => {
    const response = aiResponse.toLowerCase();
    const suggestions: string[] = [];
    
    // Check for keywords and add relevant questions
    if (response.includes('ingredient') || response.includes('contain')) {
      suggestions.push(...QUESTION_CATEGORIES.ingredients.slice(0, 2));
    }
    
    if (response.includes('sugar') || response.includes('fat') || response.includes('protein') || response.includes('sodium')) {
      suggestions.push(...QUESTION_CATEGORIES.nutrition.slice(0, 2));
    }
    
    if (response.includes('additive') || response.includes('artificial') || response.includes('msg')) {
      suggestions.push(...QUESTION_CATEGORIES.additives.slice(0, 2));
    }
    
    if (response.includes('allergen') || response.includes('soy') || response.includes('egg')) {
      suggestions.push(...QUESTION_CATEGORIES.allergens.slice(0, 2));
    }
    
    if (response.includes('vitamin') || response.includes('mineral') || response.includes('caffeine')) {
      suggestions.push(...QUESTION_CATEGORIES.vitamins.slice(0, 1));
    }
    
    // Always include interpretation questions
    suggestions.push(...QUESTION_CATEGORIES.interpretation.slice(0, 1));
    
    // Remove duplicates and limit to 5
    const uniqueSuggestions = [...new Set(suggestions)];
    return uniqueSuggestions.slice(0, 5);
  };

  const handleImageSelect = async (file: File) => {
    const imageUrl = URL.createObjectURL(file);
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      image: imageUrl,
      timestamp: new Date()
    };

    const processingMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      type: 'bot',
      message: 'Analyzing nutrition label...',
      timestamp: new Date(),
      isProcessing: true
    };

    setChatMessages(prev => [...prev, userMessage, processingMessage]);
    setIsChatLoading(true);
    setSuggestedQuestions([]); // Clear previous suggestions

    const formData = new FormData();
    formData.append('images', file);

    try {
      const response = await fetch(functionUrl, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server responded with an error: ${response.status}`);
      }
      
      const data: GeminiResponse = await response.json();
      
      setLastUploadedImage(file);

      const resultMessage: ChatMessage = {
        id: (Date.now() + 2).toString(),
        type: 'bot',
        message: data.message,
        timestamp: new Date(),
        showSuggestions: true
      };
      
      setChatMessages(prev => [...prev.filter(msg => !msg.isProcessing), resultMessage]);
      
      // Generate and set suggested questions
      const suggestions = generateSuggestedQuestions(data.message);
      setSuggestedQuestions(suggestions);

    } catch (error) {
      console.error("Error handling image upload:", error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 2).toString(),
        type: 'bot',
        message: 'Sorry, I couldn\'t analyze the image. Please try again.',
        timestamp: new Date()
      };
      setChatMessages(prev => [...prev.filter(msg => !msg.isProcessing), errorMessage]);
    } finally {
      setIsChatLoading(false);
    }
  };
  
  const handleFileTrigger = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleImageSelect(file);
    }
    if(event.target) event.target.value = '';
    setShowImageDropdown(false);
  };

  const handleCameraTrigger = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleImageSelect(file);
    }
    if(event.target) event.target.value = '';
    setShowImageDropdown(false);
  };

  const handleImageClick = (imageUrl: string) => {
    setSelectedImage(imageUrl);
    setShowImageModal(true);
  };

  const closeImageModal = () => {
    setSelectedImage(null);
    setShowImageModal(false);
  };

  const toggleImageDropdown = () => {
    setShowImageDropdown(!showImageDropdown);
  };

  const sendTextMessage = async (questionText?: string) => {
    const messageText = questionText || currentMessage.trim();
    
    if (!messageText || !lastUploadedImage) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      message: messageText,
      timestamp: new Date()
    };

    setChatMessages(prev => [...prev, userMessage]);
    setCurrentMessage('');
    setIsChatLoading(true);
    setSuggestedQuestions([]); // Hide suggestions when new question is asked

    const processingMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      type: 'bot',
      message: 'Thinking...',
      timestamp: new Date(),
      isProcessing: true,
    };
    setChatMessages(prev => [...prev, processingMessage]);

    const formData = new FormData();
    formData.append('question', messageText);
    formData.append('images', lastUploadedImage);
        
    try {
      const response = await fetch(functionUrl, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error("API call failed");

      const data: GeminiResponse = await response.json();
      
      const botResponse: ChatMessage = {
        id: (Date.now() + 2).toString(),
        type: 'bot',
        message: data.message,
        timestamp: new Date()
      };

      setChatMessages(prev => [...prev.filter(msg => !msg.isProcessing), botResponse]);

    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 2).toString(),
        type: 'bot',
        message: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date()
      };
      setChatMessages(prev => [...prev.filter(msg => !msg.isProcessing), errorMessage]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const handleSuggestionClick = (question: string) => {
    sendTextMessage(question);
  };

  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 p-4 flex-shrink-0">
        <h1 className="text-lg font-bold text-gray-900">Food Label App</h1>
        <p className="text-sm text-gray-600">Food Safety & Regulations (MY)</p>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {chatMessages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] ${
              msg.type === 'user' 
                ? 'bg-blue-600 text-white rounded-lg rounded-br-none' 
                : 'bg-white text-gray-900 rounded-lg rounded-bl-none shadow-sm border border-gray-200'
            } overflow-hidden`}>
              {msg.image && (
                <div className="p-2">
                  <img 
                    src={msg.image} 
                    alt="Nutrition label" 
                    className="w-full max-w-xs h-auto rounded-md object-cover cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => handleImageClick(msg.image!)}
                  />
                </div>
              )}
              {msg.message && (
                <div className="p-3">
                  {msg.isProcessing ? (
                    <div className="flex items-center space-x-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-sm">{msg.message}</span>
                    </div>
                  ) : (
                    <div className="text-sm whitespace-pre-wrap">
                      <FormattedMessage message={msg.message} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        
        {/* Question Suggestions */}
        {suggestedQuestions.length > 0 && !isChatLoading && (
          <div className="flex justify-start">
            <div className="max-w-[85%] bg-gray-100 rounded-lg p-4 border border-gray-200">
              <p className="text-sm font-medium text-gray-700 mb-3">You might want to ask:</p>
              <div className="space-y-2">
                {suggestedQuestions.map((question, index) => (
                  <button
                    key={index}
                    onClick={() => handleSuggestionClick(question)}
                    className="w-full text-left p-3 bg-white hover:bg-blue-50 rounded-md border border-gray-200 hover:border-blue-300 transition-colors text-sm text-gray-800 hover:text-blue-700"
                    disabled={isChatLoading}
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        
        <div ref={chatEndRef} />
      </div>

      {/* Input Area */}
      <div className="bg-white border-t border-gray-200 p-4 flex-shrink-0">
        <div className="flex items-start space-x-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileTrigger}
            className="hidden"
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleCameraTrigger}
            className="hidden"
          />
          
          {/* Image Upload Dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={toggleImageDropdown}
              className="flex items-center p-3 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full"
              disabled={isChatLoading}
            >
              <Image className="w-5 h-5" />
              <ChevronDown className="w-3 h-3 ml-1" />
            </button>
            
            {showImageDropdown && (
              <div className="absolute bottom-full left-0 mb-2 bg-white border border-gray-200 rounded-lg shadow-lg py-2 min-w-[180px] z-10">
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="w-full flex items-center px-4 py-3 hover:bg-gray-50 text-left"
                  disabled={isChatLoading}
                >
                  <Camera className="w-4 h-4 mr-3 text-blue-600" />
                  <span className="text-sm text-gray-700">Take Photo</span>
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full flex items-center px-4 py-3 hover:bg-gray-50 text-left"
                  disabled={isChatLoading}
                >
                  <Upload className="w-4 h-4 mr-3 text-gray-600" />
                  <span className="text-sm text-gray-700">Upload from Gallery</span>
                </button>
              </div>
            )}
          </div>

          <textarea
            value={currentMessage}
            onChange={(e) => setCurrentMessage(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); } }}
            placeholder={lastUploadedImage ? "Ask a question about the label..." : "Upload a nutrition label to start..."}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={1}
            disabled={isChatLoading || !lastUploadedImage}
          />
          <button
            onClick={() => sendTextMessage()}
            disabled={!currentMessage.trim() || isChatLoading}
            className="bg-blue-600 text-white p-3 rounded-full hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Image View Modal */}
      {showImageModal && selectedImage && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4">
          <div className="relative max-w-4xl max-h-full">
            <button
              onClick={closeImageModal}
              className="absolute top-4 right-4 bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-75 z-10"
            >
              <X className="w-6 h-6" />
            </button>
            <img
              src={selectedImage}
              alt="Full size nutrition label"
              className="max-w-full max-h-[90vh] object-contain rounded-lg"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default Chat;