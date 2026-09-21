import React, { useState, useRef, useEffect } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  Image,
  Send,
  Loader2,
  Camera,
  Upload,
  X,
  ChevronDown,
  LogOut,
  CircleHelp,
  Leaf,
  ScanLine,
  ShieldCheck,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { cn } from "@/lib/utils";
import {
  Message,
  MessageAvatar,
  MessageContent,
} from "@/components/ui/message";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPrimaryAction,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Component to format markdown-like text
const FormattedMessage: React.FC<{ message: string }> = ({ message }) => {
  const renderInline = (text: string) =>
    text
      .split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g)
      .filter(Boolean)
      .map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("*") && part.endsWith("*")) {
          return <em key={index}>{part.slice(1, -1)}</em>;
        }
        return part;
      });

  const formatText = (text: string) => {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const blocks: React.ReactNode[] = [];
    const listPattern = /^\s*(?:([*\-•])|(\d+)[.)])\s+(.+)$/;
    let lineIndex = 0;

    while (lineIndex < lines.length) {
      const line = lines[lineIndex].trim();
      if (!line) {
        lineIndex += 1;
        continue;
      }

      const heading = line.match(/^(#{2,3})\s+(.+)$/);
      if (heading) {
        const Heading = heading[1].length === 2 ? "h2" : "h3";
        blocks.push(<Heading key={lineIndex}>{renderInline(heading[2])}</Heading>);
        lineIndex += 1;
        continue;
      }

      const firstListItem = line.match(listPattern);
      if (firstListItem) {
        const ordered = Boolean(firstListItem[2]);
        const items: string[] = [];
        while (lineIndex < lines.length) {
          const item = lines[lineIndex].trim().match(listPattern);
          if (!item || Boolean(item[2]) !== ordered) break;
          items.push(item[3]);
          lineIndex += 1;
        }
        const List = ordered ? "ol" : "ul";
        blocks.push(
          <List key={lineIndex} className={ordered ? "mb-3 ml-5 list-decimal space-y-1" : "mb-3"}>
            {items.map((item, index) => <li key={index} className="text-foreground leading-5">{renderInline(item)}</li>)}
          </List>,
        );
        continue;
      }

      const paragraph: string[] = [];
      while (lineIndex < lines.length) {
        const nextLine = lines[lineIndex].trim();
        if (!nextLine || listPattern.test(nextLine) || /^(#{2,3})\s+/.test(nextLine)) break;
        paragraph.push(nextLine);
        lineIndex += 1;
      }
      blocks.push(<p key={lineIndex} className="mb-3 last:mb-0 text-foreground leading-relaxed">{paragraph.map((part, index) => <React.Fragment key={index}>{index > 0 && <br />}{renderInline(part)}</React.Fragment>)}</p>);
    }
    return blocks;
  };

  return <div className="foomble-answer text-sm">{formatText(message)}</div>;
};

interface ChatMessage {
  id: string;
  type: "user" | "bot";
  message?: string;
  images?: string[];
  timestamp: Date;
  isProcessing?: boolean;
  showSuggestions?: boolean;
}

const functionUrl = import.meta.env.VITE_CLOUD_FUNCTION_URL || "/api/nutritionChat";

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
    "List all allergens found in this product.",
  ],
  nutrition: [
    "How much sugar does this product contain?",
    "How much fat is in this product?",
    "How much protein is in this product?",
    "How much dietary fiber does it contain?",
    "What's the salt (sodium) content in this food?",
  ],
  additives: [
    "Does this product contain any added flavoring?",
    "Does it have any added coloring?",
    "Are there any artificial chemicals in this product?",
    "Are all the additives used in this product permitted under Malaysian food regulations?",
    "Does this food contain MSG (monosodium glutamate)?",
  ],
  vitamins: [
    "Does this product provide any vitamins?",
    "Does it contain any minerals?",
    "Is there caffeine in this product?",
  ],
  allergens: [
    "Does this product contain soy?",
    "Does this product contain egg?",
    "Alert me if this product contains any allergens.",
    "Alert me if the salt level is too high.",
    "Alert me if the sugar content is too high.",
  ],
  interpretation: [
    "I can't read the small label, can you help me read it?",
    "Help me understand the nutrition label on this product.",
  ],
  overview: [
    "Give me a simple overall summary of this label.",
    "What are the most important things to notice on this label?",
    "Is there anything I should be cautious about in this product?",
  ],
};

const Chat: React.FC = () => {
  const { user, getIdToken, signOutUser } = useAuth();
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "1",
      type: "bot",
      message:
        "Hi! I'm Foomble. Please upload a photo of a nutrition label to get started.",
      timestamp: new Date(),
    },
  ]);
  const [currentMessage, setCurrentMessage] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [lastUploadedImages, setLastUploadedImages] = useState<File[]>([]);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [showImageDropdown, setShowImageDropdown] = useState(false);
  const [showUsageDialog, setShowUsageDialog] = useState(false);
  const [pendingImages, setPendingImages] = useState<File[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const followUpRoundRef = useRef(0);
  const isWelcomeState = chatMessages.length === 1 && pendingImages.length === 0 && lastUploadedImages.length === 0;

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowImageDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    const storageKey = `foomble-usage-dialog-seen:${user.uid}`;
    if (!window.localStorage.getItem(storageKey)) setShowUsageDialog(true);
  }, [user]);

  const handleUsageDialogChange = (open: boolean) => {
    setShowUsageDialog(open);
    if (!open && user) {
      window.localStorage.setItem(`foomble-usage-dialog-seen:${user.uid}`, "true");
    }
  };

  // Choose a varied set of useful follow-ups from the answer. The rotating
  // index prevents a repeated label analysis from showing the same prompts.
  const generateSuggestedQuestions = (aiResponse: string, askedQuestion: string): string[] => {
    const response = aiResponse.toLowerCase();
    const matches = {
      ingredients: /ingredient|contain|flavou?r/.test(response),
      nutrition: /sugar|fat|protein|sodium|salt|calorie|fibre|fiber/.test(response),
      additives: /additive|artificial|msg|colour|color|preservative/.test(response),
      allergens: /allergen|soy|egg|milk|gluten|wheat|nut|shellfish/.test(response),
      vitamins: /vitamin|mineral|caffeine/.test(response),
    };
    const relevant = (Object.entries(matches)
      .filter(([, isMatch]) => isMatch)
      .map(([category]) => category) as Array<keyof typeof QUESTION_CATEGORIES>);
    const allCategories: Array<keyof typeof QUESTION_CATEGORIES> = [
      "overview", "ingredients", "nutrition", "allergens", "additives", "vitamins", "interpretation",
    ];
    const categories = [...new Set([...relevant, ...allCategories])].slice(0, 5);
    const round = followUpRoundRef.current++;
    const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
    const asked = normalise(askedQuestion);

    return categories
      .map((category, index) => {
        const questions = QUESTION_CATEGORIES[category];
        return questions[(round + index) % questions.length];
      })
      .filter((question, index, questions) => normalise(question) !== asked && questions.indexOf(question) === index);
  };

  // Must match MAX_IMAGES on the backend (index.js) so users get an
  // immediate, clear error instead of a server-side rejection.
  const MAX_IMAGES = 4;

  // Phone camera photos are often 5-8MB; resizing/re-encoding client-side
  // before upload keeps requests fast and well under the backend's 8MB
  // per-image limit. Falls back to the original file if compression fails
  // (e.g. an already-small image, or a canvas error) so uploads never break.
  const MAX_DIMENSION = 1600;
  const JPEG_QUALITY = 0.8;

  const compressImage = (file: File): Promise<File> => {
    return new Promise((resolve) => {
      // Skip non-standard image types (e.g. HEIC) that <img>/canvas can't
      // reliably decode in-browser - just send the original.
      if (!file.type.startsWith("image/") || file.type === "image/heic") {
        resolve(file);
        return;
      }

      const img = document.createElement("img");
      const objectUrl = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);

        let { width, height } = img;
        if (width <= MAX_DIMENSION && height <= MAX_DIMENSION) {
          resolve(file); // already small enough
          return;
        }

        const scale = MAX_DIMENSION / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              resolve(file);
              return;
            }
            resolve(
              new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
                type: "image/jpeg",
              }),
            );
          },
          "image/jpeg",
          JPEG_QUALITY,
        );
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        resolve(file); // fall back to original on decode failure
      };

      img.src = objectUrl;
    });
  };

  const handleImagesSelect = async (files: File[]) => {
    if (files.length === 0) return;

    const compressed = await Promise.all(files.map(compressImage));

    setPendingImages((prev) => {
      const combined = [...prev, ...compressed];
      if (combined.length > MAX_IMAGES) {
        alert(`You can attach up to ${MAX_IMAGES} images at a time.`);
        return combined.slice(0, MAX_IMAGES);
      }
      return combined;
    });
    setShowImageDropdown(false);
  };

  // Add a helper function to let users remove an image from the preview
  const removePendingImage = (indexToRemove: number) => {
    setPendingImages(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const handleFileTrigger = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      // Convert the FileList object to a standard JavaScript Array
      handleImagesSelect(Array.from(event.target.files));
    }
    if (event.target) event.target.value = "";
    setShowImageDropdown(false);
  };

  const handleCameraTrigger = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files.length > 0) {
      handleImagesSelect(Array.from(event.target.files));
    }
    if (event.target) event.target.value = "";
    setShowImageDropdown(false);
  };

  const handleImageClick = (imageUrl: string) => {
    setSelectedImage(imageUrl);
    setShowImageModal(true);
  };

  const toggleImageDropdown = () => {
    setShowImageDropdown(!showImageDropdown);
  };

  const clearSelectedImages = () => {
    setLastUploadedImages([]);
  };

  // How many prior turns to send back to the backend for context. Kept
  // small and text-only so the request stays light.
  const MAX_HISTORY_MESSAGES = 8;

  // Turns chatMessages into the { role, text } shape the backend expects,
  // dropping images, the initial greeting, and any still-processing/error
  // placeholders, and ensuring the sequence starts on a "user" turn (the
  // Gemini SDK requires this).
  const buildHistoryPayload = () => {
    const usable = chatMessages
      .filter((m) => m.message && !m.isProcessing)
      .slice(-MAX_HISTORY_MESSAGES)
      .map((m) => ({
        role: m.type === "user" ? "user" : "model",
        text: m.message as string,
      }));

    const firstUserIndex = usable.findIndex((m) => m.role === "user");
    return firstUserIndex === -1 ? [] : usable.slice(firstUserIndex);
  };

  const sendTextMessage = async (questionText?: string) => {
    const messageText = questionText || currentMessage.trim();

    // Determine which images to send:
    // If they just uploaded new ones, use those. Otherwise, use the previous context.
    const filesToSend = pendingImages.length > 0 ? pendingImages : lastUploadedImages;

    // If there is NO text and NO images, do nothing.
    // Also, your backend requires an image, so we must ensure filesToSend has something.
    if (!messageText && filesToSend.length === 0) return;
    if (filesToSend.length === 0) {
        alert("Please upload at least one image of a food label.");
        return;
    }

    // Create object URLs for the UI chat bubble (only if sending new images)
    const imageUrls = pendingImages.length > 0 ? pendingImages.map(f => URL.createObjectURL(f)) : undefined;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      type: 'user',
      message: messageText,
      images: imageUrls, // Show images in the bubble
      timestamp: new Date()
    };

    setChatMessages(prev => [...prev, userMessage]);
    setCurrentMessage('');
    setIsChatLoading(true);
    setSuggestedQuestions([]);

    // Move pending images into the "active context" and clear the preview area
    if (pendingImages.length > 0) {
      setLastUploadedImages(pendingImages);
      setPendingImages([]);
    }

    const processingMessage: ChatMessage = {
      id: (Date.now() + 1).toString(),
      type: 'bot',
      message: 'Thinking...',
      timestamp: new Date(),
      isProcessing: true,
    };
    setChatMessages(prev => [...prev, processingMessage]);

    const formData = new FormData();
    // Send either the typed question or a default fallback
    formData.append('question', messageText || "Summarize this label and packaging for me.");
    formData.append('history', JSON.stringify(buildHistoryPayload()));

    filesToSend.forEach(file => {
      formData.append('images', file);
    });

    try {
      const token = await getIdToken();
      const response = await fetch(functionUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          errorData?.message || "Unable to analyse this label right now. Please try again.",
        );
      }

      const data: GeminiResponse = await response.json();

      const botResponse: ChatMessage = {
        id: (Date.now() + 2).toString(),
        type: 'bot',
        message: data.message,
        timestamp: new Date()
      };

      setChatMessages(prev => [...prev.filter(msg => !msg.isProcessing), botResponse]);
      const suggestions = generateSuggestedQuestions(data.message, messageText);
      setSuggestedQuestions(suggestions);

    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 2).toString(),
        type: 'bot',
        message:
          error instanceof Error
            ? error.message
            : "Unable to analyse this label right now. Please try again.",
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
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {/* Header */}
      <header className="shrink-0 border-b border-border bg-card">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3 sm:px-6">
          <span className="grid size-11 place-items-center rounded-2xl bg-highlight">
            <img src="/foomble_nobg.png" alt="" className="size-9 object-contain" />
          </span>
          <div>
            <h1 className="text-lg font-bold">Foomble</h1>
            <p className="text-xs text-muted-foreground">Label intelligence for everyday food</p>
          </div>
          <div className="ml-auto flex items-center gap-2 text-right">
            <span className="hidden max-w-48 truncate text-xs text-muted-foreground md:block">{user?.email}</span>
            <button type="button" onClick={() => setShowUsageDialog(true)} className="grid size-10 place-items-center rounded-xl text-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="How to use Foomble">
              <CircleHelp className="size-4" />
            </button>
            <button type="button" onClick={() => signOutUser()} className="grid size-10 place-items-center rounded-xl text-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Sign out">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
      </header>

      <AlertDialog open={showUsageDialog} onOpenChange={handleUsageDialogChange}>
        <AlertDialogContent aria-describedby="foomble-usage-description">
          <AlertDialogHeader>
            <AlertDialogTitle>Welcome to Foomble</AlertDialogTitle>
            <AlertDialogDescription id="foomble-usage-description" className="leading-5">
              Foomble helps you understand food labels and Malaysian food regulations based on <a href="https://hq.moh.gov.my/fsq/peraturanperaturan-makanan-1985" target="_blank" rel="noopener noreferrer" className="underline hover:text-primary">Food Regulations 1985</a>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 text-sm leading-5">
            <div><span className="font-medium">1. Upload a label:</span> Add a clear photo of the ingredients or nutrition panel. You can attach up to four images at once.</div>
            <div><span className="font-medium">2. Ask a focused question:</span> Try ingredients, allergens, additives, nutrients, or Malaysian regulation questions.</div>
            <div><span className="font-medium">3. Get better results:</span> Ensure the label is well lit, in focus, and readable. Foomble is not a substitute for medical or professional advice.</div>
            <div className="rounded-lg bg-secondary px-3 py-2 text-secondary-foreground"><span className="font-medium">Testing limit:</span> 10 requests per 10-minute window and 30 requests per day. The app will tell you exactly when a short-window limit resets.</div>
            <p className="text-muted-foreground">Questions and responses may be logged during testing to help improve Foomble.</p>
          </div>
          <AlertDialogFooter>
            <AlertDialogPrimaryAction>Got it</AlertDialogPrimaryAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Chat Messages */}
      <main className="scrollbar-hidden mx-auto w-full max-w-4xl flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {isWelcomeState && (
          <section className="mx-auto flex min-h-full max-w-2xl flex-col justify-center py-6">
            <div className="relative overflow-hidden rounded-[2rem] border border-border bg-card p-6 shadow-lg shadow-primary/5 sm:p-9">
              <div aria-hidden="true" className="absolute -right-10 -top-12 size-40 rounded-full border-[26px] border-secondary" />
              <div className="relative">
                <div className="mb-6 flex items-center gap-3">
                  <div className="grid size-14 place-items-center rounded-2xl bg-highlight">
                    <img src="/foomble_nobg.png" alt="" className="size-12 object-contain" />
                  </div>
                  <div>
                    <p className="font-bold text-primary">Meet Foomble</p>
                    <p className="text-sm text-muted-foreground">Your curious label-reading companion</p>
                  </div>
                </div>
                <h2 className="max-w-xl text-balance text-3xl font-bold leading-tight sm:text-4xl">Know what’s really in the pack.</h2>
                <p className="mt-4 max-w-xl text-pretty leading-7 text-muted-foreground">Photograph an ingredient list or nutrition panel. Foomble translates the small print into clear answers about nutrients, allergens, additives, and Malaysian food rules.</p>

                <button type="button" onClick={() => fileInputRef.current?.click()} className="mt-7 flex min-h-28 w-full items-center gap-4 rounded-2xl border-2 border-dashed border-primary/35 bg-secondary/60 p-4 text-left hover:border-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"><ScanLine className="size-6" /></span>
                  <span>
                    <span className="block font-bold">Upload a food label</span>
                    <span className="mt-1 block text-sm text-muted-foreground">Start with a clear photo of the ingredients or nutrition panel</span>
                  </span>
                </button>

                <div className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
                  <div className="flex items-center gap-2"><Leaf className="size-4 text-primary" /><span>Ingredients</span></div>
                  <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /><span>Allergens</span></div>
                  <div className="flex items-center gap-2"><CircleHelp className="size-4 text-primary" /><span>Local regulations</span></div>
                </div>
              </div>
            </div>
          </section>
        )}

        {!isWelcomeState && <div className="space-y-5">
        {chatMessages.map((msg) => (
          <Message key={msg.id} align={msg.type === "user" ? "end" : "start"}>
            {msg.type === "bot" && (
              <MessageAvatar>
                <img
                  src="/foomble_nobg.png"
                  alt="Foomble"
                  className="size-10 object-contain p-1"
                />
              </MessageAvatar>
            )}
            <MessageContent className={msg.type === "user" ? "items-end" : "items-start"}>
            <div
              className={cn(
                "max-w-[88%] overflow-hidden sm:max-w-[78%]",
                msg.type === "user"
                  ? "rounded-2xl rounded-br-md bg-highlight text-highlight-foreground"
                  : "rounded-2xl rounded-bl-md border border-border bg-card text-card-foreground shadow-sm",
              )}
            >
              {msg.images && msg.images.length > 0 && (
                <div className="p-2 flex flex-wrap gap-2">
                  {msg.images.map((imgUrl, index) => (
                    <button
                      key={index}
                      type="button"
                      onClick={() => handleImageClick(imgUrl)}
                      className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Open uploaded label ${index + 1}`}
                    >
                      <img
                        src={imgUrl}
                        alt=""
                        className="size-24 rounded-xl border border-highlight-border object-cover hover:opacity-90 sm:size-32"
                      />
                    </button>
                  ))}
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
                    <div className="whitespace-pre-wrap text-sm">
                      <FormattedMessage message={msg.message} />
                    </div>
                  )}
                </div>
              )}
            </div>
            </MessageContent>
          </Message>
        ))}

        {/* Question Suggestions */}
        {suggestedQuestions.length > 0 && !isChatLoading && (
          <div className="flex justify-start">
            <div className="max-w-[88%] border-l-2 border-primary pl-4 sm:max-w-[78%]">
              <p className="mb-3 text-sm font-bold text-secondary-foreground">
                Keep exploring
              </p>
              <div className="space-y-2">
                {suggestedQuestions.map((question, index) => (
                  <button
                    key={index}
                    onClick={() => handleSuggestionClick(question)}
                    className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-left text-sm text-accent-foreground hover:border-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        </div>}
      </main>

      {/* Input Area */}
      <div className="shrink-0 border-t border-border bg-card pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-4xl p-4 sm:px-6">

        {lastUploadedImages.length > 0 && (
          <div className="mb-3 flex items-center justify-between bg-highlight-muted p-2 px-3 rounded-xl border border-highlight-border">
            <div className="flex items-center space-x-2">
              <Image className="w-4 h-4 text-highlight-foreground" />
              <span className="text-xs text-highlight-foreground font-medium">
                {lastUploadedImages.length} image
                {lastUploadedImages.length > 1 ? "s" : ""} attached for next
                question
              </span>
            </div>
            <button
              onClick={clearSelectedImages}
              disabled={isChatLoading}
              className="text-highlight-foreground hover:bg-highlight p-1 rounded-full transition-colors disabled:opacity-50"
              title="Clear attached images"
              aria-label="Clear attached images"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {pendingImages.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3 p-3 bg-card rounded-xl border border-border">
            {pendingImages.map((file, index) => (
              <div key={index} className="relative group">
                <img
                  src={URL.createObjectURL(file)}
                  alt="pending upload"
                  className="w-16 h-16 object-cover rounded-lg border border-border shadow-sm"
                />
                <button
                  onClick={() => removePendingImage(index)}
                  className="absolute -top-2 -right-2 bg-primary text-primary-foreground rounded-full p-1 shadow-md hover:bg-primary/90 transition-colors"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input Flex Container */}
        <div className="flex items-start space-x-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
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
              className="flex min-h-11 items-center rounded-xl p-3 text-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              disabled={isChatLoading}
              aria-label="Add label images"
              aria-expanded={showImageDropdown}
              aria-controls="image-upload-menu"
            >
              <Image className="w-5 h-5" />
              <ChevronDown className="w-3 h-3 ml-1" />
            </button>

            {showImageDropdown && (
              <div id="image-upload-menu" className="absolute bottom-full left-0 z-10 mb-2 min-w-48 rounded-xl border border-border bg-popover py-2 shadow-lg">
                <button
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex min-h-11 w-full items-center px-4 py-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  disabled={isChatLoading}
                >
                  <Camera className="w-4 h-4 mr-3 text-primary" />
                  <span className="text-sm text-foreground">Take photo</span>
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex min-h-11 w-full items-center px-4 py-3 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  disabled={isChatLoading}
                >
                  <Upload className="w-4 h-4 mr-3 text-primary" />
                  <span className="text-sm text-foreground">
                    Upload from Gallery
                  </span>
                </button>
              </div>
            )}
          </div>

          <textarea
            value={currentMessage}
            onChange={(e) => setCurrentMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                // Only send if we have text OR if we have new pending images
                if (currentMessage.trim() || pendingImages.length > 0) {
                  sendTextMessage();
                }
              }
            }}
            placeholder={
              pendingImages.length > 0 || lastUploadedImages.length > 0
                ? "Ask a question about the labels..."
                : "Upload a nutrition label to start..."
            }
            className="w-full border border-input bg-card rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:border-ring"
            aria-label="Ask Foomble about the uploaded food label"
            rows={1}
            // Unlock if we have EITHER pending images OR previously uploaded images
            disabled={isChatLoading || (lastUploadedImages.length === 0 && pendingImages.length === 0)}
          />
          <button
            onClick={() => sendTextMessage()}
            // Disable logic:
            // 1. If it's loading
            // 2. If there are NO new images AND NO text (prevents sending an empty request)
            disabled={
              isChatLoading ||
              (pendingImages.length === 0 && !currentMessage.trim())
            }
            className="bg-highlight text-highlight-foreground p-3 rounded-xl hover:bg-highlight/85 disabled:bg-secondary disabled:text-muted-foreground disabled:cursor-not-allowed transition-colors"
            aria-label="Send question"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
        </div>
      </div>

      <DialogPrimitive.Root
        open={showImageModal}
        onOpenChange={(open) => {
          setShowImageModal(open);
          if (!open) setSelectedImage(null);
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/75" />
          {selectedImage && (
            <DialogPrimitive.Content
              aria-label="Uploaded food label preview"
              className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 focus:outline-none"
            >
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  className="absolute right-3 top-3 z-10 grid size-11 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  aria-label="Close image preview"
                >
                  <X className="size-5" />
                </button>
              </DialogPrimitive.Close>
              <img
                src={selectedImage}
                alt="Full-size nutrition label"
                className="mx-auto max-h-[calc(100dvh-2rem)] max-w-full rounded-xl object-contain"
              />
            </DialogPrimitive.Content>
          )}
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </div>
  );
};

export default Chat;
