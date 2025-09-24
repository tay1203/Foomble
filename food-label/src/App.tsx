import React, { useState, useRef, useEffect } from 'react';
import { Camera, Upload, Send, Bot, User, Image, X, Loader2 } from 'lucide-react';

interface ChatMessage {
  id: string;
  type: 'user' | 'bot';
  message?: string;
  image?: string;
  timestamp: Date;
  isProcessing?: boolean;
}

const functionUrl = import.meta.env.VITE_CLOUD_FUNCTION_URL;

type GeminiResponse = {
  message: string;
  context: string;
};

const NutritionChatApp: React.FC = () => {

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      type: 'bot',
      message: 'Hi! Upload a nutrition label image and I\'ll help you understand food regulations and answer questions about it. 📷',
      timestamp: new Date()
    }
  ]);
  const [currentMessage, setCurrentMessage] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  
  const [nutritionContext, setNutritionContext] = useState<string>('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Auto-resize textarea
  // useEffect(() => {
  //   if (textareaRef.current) {
  //     textareaRef.current.style.height = 'auto';
  //     textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px';
  //   }
  // }, [currentMessage]);

  const handleImageSelect = async (file: File) => {
    // Add user message with image
    const imageUrl = URL.createObjectURL(file);
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      image: imageUrl,
      timestamp: new Date()
    };

    // Add processing message
    const processingMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      type: 'bot',
      message: 'Analyzing nutrition label...',
      timestamp: new Date(),
      isProcessing: true
    };

    setChatMessages(prev => [...prev, userMessage, processingMessage]);
    setIsChatLoading(true);

    const formData = new FormData();
    // Use 'images' key to match the multi-image backend we built
    formData.append('images', file); 

    try {
      // API call
      const response = await fetch(functionUrl, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server responded with an error: ${response.status}`);
      }
      
      // tell TypeScript to expect the response to match our GeminiResponse type.
      const data: GeminiResponse = await response.json();
      setNutritionContext(data.context);

      const resultMessage: ChatMessage = {
        id: (Date.now() + 2).toString(),
        type: 'bot',
        // FIX: Use the actual message from the backend
        message: data.message,
        timestamp: new Date()
      };
      
      // Replace "processing..." with the actual result
      setChatMessages(prev => [...prev.filter(msg => !msg.isProcessing), resultMessage]);

    } catch (error) {
      console.error("Error handling image upload:", error);
      // Remove processing message and add error
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
  

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleImageSelect(file);
    }
  };

  const handleFileTrigger = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleImageSelect(file);
    }
    // Reset the input value to allow uploading the same file again
    if(event.target) event.target.value = '';
  };


  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200 p-4 flex-shrink-0">
        <div className="flex items-center space-x-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Food Label App</h1>
            <p className="text-sm text-gray-600">Food Safety & Regulations</p>
          </div>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {chatMessages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] ${
              msg.type === 'user' 
                ? 'bg-blue-600 text-white rounded-lg rounded-br-md' 
                : 'bg-white text-gray-900 rounded-lg rounded-bl-md shadow-sm border border-gray-200'
            } overflow-hidden`}>
              
              {/* Image message */}
              {msg.image && (
                <div className="relative">
                  <img 
                    src={msg.image} 
                    alt="Nutrition label" 
                    className="w-full h-48 object-cover"
                  />
                  <div className="absolute bottom-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded">
                    Nutrition Label
                  </div>
                </div>
              )}
              
              {/* Text message */}
              {msg.message && (
                <div className="p-3">
                  <div className="flex items-start space-x-2">
                    <div className="flex-1">
                      {msg.isProcessing ? (
                        <div className="flex items-center space-x-2">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="text-sm">{msg.message}</span>
                        </div>
                      ) : (
                        <div className="text-sm whitespace-pre-line">{msg.message}</div>
                      )}
                    </div>
                    {msg.type === 'user' && !msg.image && (
                      <User className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    )}
                  </div>
                  <div className={`text-xs mt-1 ${msg.type === 'user' ? 'text-blue-200' : 'text-gray-500'}`}>
                    {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        
        {isChatLoading && (
          <div className="flex justify-start">
            <div className="bg-white border border-gray-200 p-3 rounded-lg rounded-bl-md shadow-sm">
              <div className="flex items-center space-x-2">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                  <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Input Area */}
        <div className="bg-white border-t border-gray-200 p-4 flex-shrink-0">
            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileTrigger}
                className="hidden"
            />
            <div className="flex items-start space-x-2">
                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-3 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full border border-gray-200"
                    disabled={isChatLoading}
                >
                    <Image className="w-5 h-5" />
                </button>
                <textarea
                    value={currentMessage}
                    onChange={(e) => setCurrentMessage(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendTextMessage(); } }}
                    placeholder={nutritionContext ? "Ask a question about the label..." : "Upload a nutrition label to start..."}
                    className="w-full border border-gray-300 rounded-lg px-3 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                    rows={1}
                    disabled={isChatLoading || !nutritionContext} // Disable input until an image is analyzed
                />
                <button
                    onClick={sendTextMessage}
                    disabled={!currentMessage.trim() || isChatLoading}
                    className="bg-blue-600 text-white p-3 rounded-full hover:bg-blue-700 disabled:bg-gray-400"
                >
                    <Send className="w-5 h-5" />
                </button>
            </div>
        </div>
        
        {/* Quick Suggestions */}
        {/* {(
          <div className="flex flex-wrap gap-2 mt-3">
            {[
              "What allergens need to be declared?",
              "Labeling requirements?",
              "Export regulations?",
              "Health claims allowed?"
            ].map((suggestion, index) => (
              <button
                key={index}
                onClick={() => setCurrentMessage(suggestion)}
                className="text-xs bg-gray-100 text-gray-700 px-3 py-2 rounded-full hover:bg-gray-200 border border-gray-200"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )} */}
      </div>
  );

  function handleKeyPress(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (currentMessage.trim()) {
        sendTextMessage();
      }
    }
  }

  async function sendTextMessage() {
    if (!currentMessage.trim()) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      message: currentMessage,
      timestamp: new Date()
    };

    setChatMessages(prev => [...prev, userMessage]);
    const question = currentMessage;
    setCurrentMessage('');
    setIsChatLoading(true);

    const processingMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      type: 'bot',
      message: 'Thinking...',
      timestamp: new Date(),
      isProcessing: true,
    };
    setChatMessages(prev => [...prev, processingMessage]);

    const formData = new FormData();
    formData.append('question', question);
    formData.append('context', nutritionContext); // Send the context back!
      

    try {
      const response = await fetch(functionUrl, {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) throw new Error("API call failed");

      const data: GeminiResponse = await response.json();
      
      const botResponse: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'bot',
        message: data.message,
        timestamp: new Date()
      };

      setChatMessages(prev => [...prev, botResponse]);

    } catch (error) {
      console.error('Error sending message:', error);
      
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        type: 'bot',
        message: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date()
      };

      setChatMessages(prev => [...prev, errorMessage]);
      
    } finally {
      setIsChatLoading(false);
    }
  }
  
}
export default NutritionChatApp;