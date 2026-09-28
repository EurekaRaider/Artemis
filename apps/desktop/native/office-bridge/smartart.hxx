// SPDX-License-Identifier: MPL-2.0
// UNO text updates do not notify LibreOffice 26.8's SmartArt data model.
// Keep the existing diagram parts and synchronize only an unambiguous text node.
#include <com/sun/star/container/XNamed.hpp>
#include <com/sun/star/embed/XStorage.hpp>
#include <com/sun/star/embed/XTransactedObject.hpp>
#include <com/sun/star/embed/ElementModes.hpp>
#include <com/sun/star/io/XActiveDataSource.hpp>
#include <com/sun/star/io/XStream.hpp>
#include <com/sun/star/lang/XInitialization.hpp>
#include <com/sun/star/lang/XSingleServiceFactory.hpp>
#include <com/sun/star/xml/dom/XDocumentBuilder.hpp>
#include <com/sun/star/xml/dom/XElement.hpp>
#include <com/sun/star/xml/dom/XNodeList.hpp>
#include <com/sun/star/xml/sax/XSAXSerializable.hpp>
#include <com/sun/star/xml/sax/XDocumentHandler.hpp>
#include <filesystem>
#include <map>

class SmartArtText {
    using Dom = Reference<css::xml::dom::XDocument>;
    using Element = Reference<css::xml::dom::XElement>;
    Reference<css::uno::XComponentContext> context;
    std::string source;
    struct Edit { OUString model; std::string before, after; };
    std::vector<Edit> edits;
    const OUString drawing = u("http://schemas.openxmlformats.org/drawingml/2006/main");
    const OUString diagram = u("http://schemas.openxmlformats.org/drawingml/2006/diagram");

    Reference<css::uno::XInterface> service(const char* name) {
        return context->getServiceManager()->createInstanceWithContext(u(name), context);
    }
    Dom parse(const Reference<css::io::XInputStream>& stream) {
        css::uno::Sequence<sal_Int8> chunk;
        std::vector<sal_Int8> bytes;
        while (auto count = stream->readBytes(chunk, 8192)) {
            if (bytes.size() + count > 8 * 1024 * 1024) throw std::runtime_error("Diagram XML exceeds limit");
            bytes.insert(bytes.end(), chunk.begin(), chunk.begin() + count);
        }
        stream->closeInput();
        const std::string xml(bytes.begin(), bytes.end());
        if (xml.find('\0') != std::string::npos || xml.find("<!DOCTYPE") != std::string::npos || xml.find("<!ENTITY") != std::string::npos)
            throw std::runtime_error("Diagram XML contains unsupported declarations or encoding");
        auto input = service("com.sun.star.io.SequenceInputStream");
        css::uno::Any data; data <<= css::uno::Sequence<sal_Int8>(bytes.data(), static_cast<sal_Int32>(bytes.size()));
        Reference<css::lang::XInitialization>(input, UNO_QUERY_THROW)->initialize({&data, 1});
        return Reference<css::xml::dom::XDocumentBuilder>(service("com.sun.star.xml.dom.DocumentBuilder"), UNO_QUERY_THROW)->parse(Reference<css::io::XInputStream>(input, UNO_QUERY_THROW));
    }
    static std::vector<std::string> lines(const std::string& text) {
        std::vector<std::string> result;
        size_t start = 0, end;
        while ((end = text.find('\n', start)) != std::string::npos) { result.push_back(text.substr(start, end - start)); start = end + 1; }
        result.push_back(text.substr(start));
        return result;
    }
    std::string content(const Element& body) {
        auto paragraphs = body->getElementsByTagNameNS(drawing, u("p"));
        std::string result;
        for (int p = 0; p < paragraphs->getLength(); p++) {
            if (p) result += '\n';
            auto texts = Element(paragraphs->item(p), UNO_QUERY_THROW)->getElementsByTagNameNS(drawing, u("t"));
            for (int t = 0; t < texts->getLength(); t++)
                for (auto node = texts->item(t)->getFirstChild(); node.is(); node = node->getNextSibling()) result += s(node->getNodeValue());
        }
        return result;
    }
    void replace(const Element& body, const std::string& text) {
        const auto values = lines(text);
        auto paragraphs = body->getElementsByTagNameNS(drawing, u("p"));
        if (values.size() != static_cast<size_t>(paragraphs->getLength())) throw std::runtime_error("SmartArt text edits must preserve paragraph count");
        for (int p = 0; p < paragraphs->getLength(); p++) {
            auto texts = Element(paragraphs->item(p), UNO_QUERY_THROW)->getElementsByTagNameNS(drawing, u("t"));
            if (!texts->getLength()) throw std::runtime_error("SmartArt empty paragraph cannot be mapped safely");
            for (int t = 0; t < texts->getLength(); t++) {
                auto node = texts->item(t);
                while (node->hasChildNodes()) node->removeChild(node->getFirstChild());
                node->appendChild(Reference<css::xml::dom::XNode>(body->getOwnerDocument()->createTextNode(u(t ? "" : values[p])), UNO_QUERY_THROW));
            }
        }
    }
public:
    explicit SmartArtText(const Reference<css::uno::XComponentContext>& value) : context(value) {}
    void open(const std::string& path) { source = path; edits.clear(); }
    void prepare(const OUString& objectName, const std::string& before, const std::string& after) {
        if (objectName.isEmpty() || before.empty()) return;
        auto zip = service("com.sun.star.packages.zip.ZipFileAccess");
        css::uno::Any path; path <<= url(source);
        Reference<css::lang::XInitialization>(zip, UNO_QUERY_THROW)->initialize({&path, 1});
        Reference<css::container::XNameAccess> entries(zip, UNO_QUERY_THROW);
        auto read = [&](const OUString& name) { return parse(Reference<css::io::XInputStream>(entries->getByName(name), UNO_QUERY_THROW)); };
        std::string part;
        int matches = 0;
        for (const auto& entry : entries->getElementNames()) {
            auto name = s(entry);
            if (name.rfind("ppt/slides/slide", 0) != 0 || name.find("/_rels/") != std::string::npos || name.size() < 4 || name.substr(name.size() - 4) != ".xml") continue;
            auto document = read(entry);
            auto names = document->getElementsByTagNameNS(u("http://schemas.openxmlformats.org/presentationml/2006/main"), u("cNvPr"));
            for (int i = 0; i < names->getLength(); i++) {
                Element named(names->item(i), UNO_QUERY_THROW);
                if (named->getAttribute(u("name")) != objectName) continue;
                matches++;
                Element frame(named->getParentNode()->getParentNode(), UNO_QUERY_THROW);
                auto links = frame->getElementsByTagNameNS(diagram, u("relIds"));
                if (links->getLength() != 1) continue;
                auto relationship = Element(links->item(0), UNO_QUERY_THROW)->getAttributeNS(u("http://schemas.openxmlformats.org/officeDocument/2006/relationships"), u("dm"));
                auto relationships = read(u("ppt/slides/_rels/" + name.substr(name.find_last_of('/') + 1) + ".rels"));
                auto list = relationships->getElementsByTagNameNS(u("http://schemas.openxmlformats.org/package/2006/relationships"), u("Relationship"));
                for (int r = 0; r < list->getLength(); r++) {
                    Element link(list->item(r), UNO_QUERY_THROW);
                    if (link->getAttribute(u("Id")) != relationship) continue;
                    if (link->getAttribute(u("TargetMode")) == u("External")) throw std::runtime_error("External diagram data is unsupported");
                    auto target = s(link->getAttribute(u("Target")));
                    if (target.find('\\') != std::string::npos || target.find(':') != std::string::npos) throw std::runtime_error("Invalid diagram relationship");
                    part = (std::filesystem::path("ppt/slides") / target).lexically_normal().generic_string();
                }
            }
        }
        if (part.empty()) return; // An ordinary group uses the normal UNO writer.
        if (matches != 1 || part.rfind("ppt/diagrams/", 0) != 0) throw std::runtime_error("Ambiguous SmartArt object identity");
        for (const auto& entry : entries->getElementNames()) {
            const auto name = s(entry);
            if (name.rfind("ppt/diagrams/drawing", 0) == 0 && name.size() > 4 && name.substr(name.size() - 4) == ".xml" && read(entry)->getElementsByTagNameNS(drawing, u("t"))->getLength())
                throw std::runtime_error("SmartArt with cached drawing text cannot be updated safely");
        }
        auto document = read(u(part));
        auto bodies = document->getElementsByTagNameNS(diagram, u("t"));
        Element selected;
        OUString model;
        for (int i = 0; i < bodies->getLength(); i++) {
            Element body(bodies->item(i), UNO_QUERY_THROW);
            auto id = Element(body->getParentNode(), UNO_QUERY_THROW)->getAttribute(u("modelId"));
            auto text = content(body);
            for (const auto& edit : edits) if (edit.model == id) text = edit.after;
            if (text != before) continue;
            if (selected.is()) throw std::runtime_error("Ambiguous SmartArt text node");
            selected = body; model = id;
        }
        if (!selected.is() || model.isEmpty()) throw std::runtime_error("SmartArt text node cannot be mapped safely");
        replace(selected, after); // Validate the bounded edit before changing the live shape.
        edits.push_back({model, before, after});
    }
    void save(const std::string& path) {
        if (edits.empty()) return;
        const char* step = "open exported archive";
        try {
        css::uno::Sequence<css::uno::Any> args(3);
        args[0] <<= url(path); args[1] <<= css::embed::ElementModes::READWRITE;
        args[2] <<= props({prop("StorageFormat", u("ZipFormat"))});
        auto root = Reference<css::embed::XStorage>(Reference<css::lang::XSingleServiceFactory>(service("com.sun.star.embed.StorageFactory"), UNO_QUERY_THROW)->createInstanceWithArguments(args), UNO_QUERY_THROW);
        auto ppt = root->openStorageElement(u("ppt"), css::embed::ElementModes::READWRITE);
        auto parts = ppt->openStorageElement(u("diagrams"), css::embed::ElementModes::READWRITE);
        step = "read diagram data";
        std::map<std::string, Dom> documents;
        for (const auto& name : parts->getElementNames()) {
            const auto file = s(name);
            if (file.rfind("data", 0) != 0 || file.size() < 4 || file.substr(file.size() - 4) != ".xml") continue;
            documents.emplace(file, parse(parts->openStreamElement(name, css::embed::ElementModes::READ)->getInputStream()));
        }
        step = "update diagram data";
        for (const auto& edit : edits) {
            int matches = 0;
            for (auto& [name, document] : documents) {
                auto bodies = document->getElementsByTagNameNS(diagram, u("t"));
                for (int i = 0; i < bodies->getLength(); i++) {
                    Element body(bodies->item(i), UNO_QUERY_THROW);
                    if (Element(body->getParentNode(), UNO_QUERY_THROW)->getAttribute(u("modelId")) != edit.model) continue;
                    if (content(body) != edit.before && content(body) != edit.after) throw std::runtime_error("SmartArt data changed during export");
                    replace(body, edit.after); matches++;
                }
            }
            if (matches != 1) throw std::runtime_error("SmartArt export lost its stable text node");
        }
        step = "write diagram data";
        for (const auto& [name, document] : documents) {
            step = "open diagram output";
            auto stream = parts->openStreamElement(u(name), css::embed::ElementModes::WRITE | css::embed::ElementModes::TRUNCATE);
            auto output = stream->getOutputStream();
            step = "create diagram writer";
            auto writer = service("com.sun.star.xml.sax.Writer");
            Reference<css::io::XActiveDataSource>(writer, UNO_QUERY_THROW)->setOutputStream(output);
            step = "serialize diagram";
            Reference<css::xml::sax::XSAXSerializable>(document, UNO_QUERY_THROW)->serialize(Reference<css::xml::sax::XDocumentHandler>(writer, UNO_QUERY_THROW), {});
            // SAX Writer closes its output when serialization ends.
        }
        step = "commit diagram data";
        for (const auto& storage : {parts, ppt, root}) Reference<css::embed::XTransactedObject>(storage, UNO_QUERY_THROW)->commit();
        Reference<css::lang::XComponent>(root, UNO_QUERY_THROW)->dispose();
        } catch (const css::uno::Exception& error) { throw std::runtime_error(std::string("SmartArt ") + step + ": " + s(error.Message)); }
    }
};
