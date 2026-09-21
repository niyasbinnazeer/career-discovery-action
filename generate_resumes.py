import os
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn

from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_JUSTIFY
from reportlab.pdfgen import canvas

def set_cell_border(cell, **kwargs):
    """Set cell's border
    Usage:
    set_cell_border(
        cell,
        top={"sz": 12, "val": "single", "color": "FF0000", "space": "0"},
        bottom={"sz": 12, "color": "00FF00", "val": "single"},
        left={"sz": 24, "val": "lines", "color": "0000FF"},
        right={"sz": 12, "val": "dashed", "color": "00FF00"},
    )
    """
    tcPr = cell._tc.get_or_add_tcPr()
    tcBorders = tcPr.first_child_found_in("w:tcBorders")
    if tcBorders is None:
        tcBorders = OxmlElement('w:tcBorders')
        tcPr.append(tcBorders)
    for edge in ('top', 'left', 'bottom', 'right', 'insideH', 'insideV'):
        edge_data = kwargs.get(edge)
        if edge_data:
            tag = 'w:{}'.format(edge)
            element = tcBorders.find(qn(tag))
            if element is None:
                element = OxmlElement(tag)
                tcBorders.append(element)
            for key in ["sz", "val", "color", "space", "shadow"]:
                if key in edge_data:
                    element.set(qn('w:{}'.format(key)), str(edge_data[key]))

def add_p_border_bottom(p, color_hex="1E3A8A", sz="12"):
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), sz)
    bottom.set(qn('w:space'), '4')
    bottom.set(qn('w:color'), color_hex)
    pBdr.append(bottom)
    pPr.append(pBdr)

def generate_docx(output_path):
    doc = Document()
    
    # 0.55 in margins for perfect 2-page fit
    for section in doc.sections:
        section.top_margin = Inches(0.5)
        section.bottom_margin = Inches(0.5)
        section.left_margin = Inches(0.55)
        section.right_margin = Inches(0.55)
        
    primary_color = RGBColor(0x1E, 0x3A, 0x8A) # Navy
    dark_gray = RGBColor(0x37, 0x41, 0x51)
    charcoal = RGBColor(0x1F, 0x29, 0x37)
    muted_gray = RGBColor(0x4B, 0x55, 0x63)
    
    # Header Name
    p_name = doc.add_paragraph()
    p_name.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_name.paragraph_format.space_before = Pt(0)
    p_name.paragraph_format.space_after = Pt(2)
    run_name = p_name.add_run("SUDAKSHINA DEB")
    run_name.font.name = "Calibri"
    run_name.font.size = Pt(20)
    run_name.font.bold = True
    run_name.font.color.rgb = primary_color
    
    # Headline
    p_sub = doc.add_paragraph()
    p_sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_sub.paragraph_format.space_before = Pt(0)
    p_sub.paragraph_format.space_after = Pt(3)
    run_sub = p_sub.add_run("Senior Scientist — Discovery Biology & Downstream Protein Sciences")
    run_sub.font.name = "Calibri"
    run_sub.font.size = Pt(11.5)
    run_sub.font.bold = True
    run_sub.font.color.rgb = dark_gray
    
    # Contact
    p_con = doc.add_paragraph()
    p_con.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p_con.paragraph_format.space_before = Pt(0)
    p_con.paragraph_format.space_after = Pt(8)
    run_con = p_con.add_run("Bengaluru, India  |  +91-7005314758  |  sudakshinadeb97@gmail.com  |  linkedin.com/in/sudakshina-deb")
    run_con.font.name = "Calibri"
    run_con.font.size = Pt(9.5)
    run_con.font.color.rgb = muted_gray
    
    def add_section_header(title):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(8)
        p.paragraph_format.space_after = Pt(3)
        run = p.add_run(title.upper())
        run.font.name = "Calibri"
        run.font.size = Pt(11)
        run.font.bold = True
        run.font.color.rgb = primary_color
        add_p_border_bottom(p, "1E3A8A", "10")
        
    def add_bullet(bold_prefix, text):
        p = doc.add_paragraph(style='List Bullet')
        p.paragraph_format.space_before = Pt(1.5)
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.line_spacing = 1.12
        if bold_prefix:
            r_b = p.add_run(bold_prefix + " ")
            r_b.font.name = "Calibri"
            r_b.font.size = Pt(9.5)
            r_b.font.bold = True
            r_b.font.color.rgb = charcoal
        r_t = p.add_run(text)
        r_t.font.name = "Calibri"
        r_t.font.size = Pt(9.5)
        r_t.font.color.rgb = dark_gray

    # 1. Professional Profile
    add_section_header("Professional Profile")
    p_prof = doc.add_paragraph()
    p_prof.paragraph_format.space_before = Pt(2)
    p_prof.paragraph_format.space_after = Pt(6)
    p_prof.paragraph_format.line_spacing = 1.15
    r_prof = p_prof.add_run(
        "Results-driven Senior Scientist with ~4 years of biopharmaceutical industry experience in Discovery Biology and "
        "Downstream Protein Sciences at Syngene International Ltd. Proven track record leading end-to-end purification of "
        "complex biologics—including monoclonal antibodies (mAbs), bispecific antibodies (bsAbs), and His-tagged recombinant "
        "proteins—utilizing ÄKTA chromatography systems (Protein A/G, Ni-NTA, IEX, HIC, SEC) and Tangential Flow Filtration (TFF). "
        "Highly proficient in analytical release testing and quality characterization (SEC-HPLC, SDS-PAGE, Western blot, LC-MS/MS, "
        "UV-Vis, Endosafe kinetic LAL endotoxin assays) under strict GLP/ALCOA++ data integrity compliance. Seamlessly integrates "
        "wet-lab bioprocess rigor with computational genomics and bioinformatics workflows (Python, R, QIIME2, AlphaFold2). "
        "Conferred the Syngene SPOT Award (Feb 2023) for rapid troubleshooting and high-recovery protein delivery for global biopharma clients."
    )
    r_prof.font.name = "Calibri"
    r_prof.font.size = Pt(9.5)
    r_prof.font.color.rgb = dark_gray

    # 2. Core Technical Competencies
    add_section_header("Core Technical Competencies")
    add_bullet("Downstream Bioprocess & Chromatography:", "ÄKTA Pure, ÄKTA Avant, UNICORN software; Affinity (Protein A/G, Ni-NTA His-tag), Ion Exchange (IEX/CEX/AEX), Hydrophobic Interaction (HIC), Size Exclusion (SEC/GFC); Desalting, Buffer Exchange, Batch Binding, Dialysis, Ultrafiltration/Diafiltration (UF/DF), Tangential Flow Filtration (TFF, Pellicon cassettes).")
    add_bullet("Bioanalytical Characterization & Quality Release:", "SEC-HPLC (monomer purity & aggregate profiling), SDS-PAGE (reducing/non-reducing), Western Blotting, LC-MS/MS, UV-Vis Spectrophotometry, Endosafe PTS/MCS (kinetic LAL endotoxin testing/removal), Flow Cytometry, Protein Impurity Characterization.")
    add_bullet("Molecular Biology & Laboratory Workflows:", "Recombinant protein expression, PCR, Primer Design, Sanger Sequencing, Gene Expression Profiling, Aseptic Mammalian Cell Culture, Media Prep, Passaging, In Vivo Animal Handling (rodent surgical procedures, model organisms).")
    add_bullet("Computational Biology & Data Science:", "Python (Pandas, Biopython), R (tidyverse), Linux/Bash shell scripting, NGS Genomic Data Analysis, QIIME2 (DADA2 pipeline), AlphaFold2 (ColabFold), In Silico Antibody CDR Engineering, Biological Databases (SILVA, NCBI BLAST, STRING, ExPASy).")
    add_bullet("Quality & Regulatory Governance:", "ALCOA++ Data Integrity Standards, Standard Operating Procedures (SOPs), Batch Manufacturing Records (BMRs), GLP/GMP Laboratory Compliance, Cross-Functional Client Milestone Delivery.")

    # 3. Professional Experience
    add_section_header("Professional Industry Experience")
    
    # Syngene
    p_exp1 = doc.add_paragraph()
    p_exp1.paragraph_format.space_before = Pt(4)
    p_exp1.paragraph_format.space_after = Pt(1)
    r1 = p_exp1.add_run("SYNGENE INTERNATIONAL LIMITED")
    r1.bold = True
    r1.font.name = "Calibri"
    r1.font.size = Pt(10.5)
    r1.font.color.rgb = charcoal
    r1_sub = p_exp1.add_run("  |  Bengaluru, India")
    r1_sub.font.name = "Calibri"
    r1_sub.font.size = Pt(9.5)
    r1_sub.font.color.rgb = muted_gray

    p_exp1_sub = doc.add_paragraph()
    p_exp1_sub.paragraph_format.space_before = Pt(0)
    p_exp1_sub.paragraph_format.space_after = Pt(2)
    r1_t = p_exp1_sub.add_run("Senior Scientist – Discovery Biology")
    r1_t.bold = True
    r1_t.italic = True
    r1_t.font.name = "Calibri"
    r1_t.font.size = Pt(10)
    r1_t.font.color.rgb = primary_color
    r1_d = p_exp1_sub.add_run("  |  May 2022 – Present")
    r1_d.font.name = "Calibri"
    r1_d.font.size = Pt(9.5)
    r1_d.font.color.rgb = muted_gray

    add_bullet("Biotherapeutic Downstream Purification:", "Lead multi-step preparative chromatography purification workflows for 40+ recombinant therapeutic projects, including mono- and bi-specific antibodies and His-tagged proteins using ÄKTA Pure and ÄKTA Avant systems.")
    add_bullet("Chromatography Method Development:", "Developed, scaled, and standardized chromatographic purification protocols across Protein A/G, Ni-NTA, CEX, AEX, HIC, and SEC, consistently achieving >95% monomer purity and quantitative recovery yields.")
    add_bullet("Bioprocess & TFF Filtration:", "Formulated and optimized Tangential Flow Filtration (TFF) and ultrafiltration/diafiltration (UF/DF) operational parameters, improving cycle turnaround by 25% while safeguarding product stability.")
    add_bullet("Analytical Release Testing:", "Conducted routine release testing and quality characterization via SEC-HPLC aggregate profiling, reducing and non-reducing SDS-PAGE, Western blot validation, UV-Vis, and Endosafe kinetic LAL endotoxin quantification.")
    add_bullet("Cross-Functional Client Delivery:", "Collaborated with cross-functional Discovery Biology and analytical teams to optimize protocols, troubleshoot challenging aggregation barriers, and ensure timely delivery of complex proteins for global biopharma clients.")
    add_bullet("Syngene SPOT Award (Feb 2023):", "Recognized with departmental SPOT Award for producing and delivering highly challenging proteins within compressed timelines, earning direct client commendation.")

    # RGCB
    p_exp2 = doc.add_paragraph()
    p_exp2.paragraph_format.space_before = Pt(5)
    p_exp2.paragraph_format.space_after = Pt(1)
    r2 = p_exp2.add_run("RAJIV GANDHI CENTRE FOR BIOTECHNOLOGY (RGCB)")
    r2.bold = True
    r2.font.name = "Calibri"
    r2.font.size = Pt(10.5)
    r2.font.color.rgb = charcoal
    r2_sub = p_exp2.add_run("  |  Trivandrum, India")
    r2_sub.font.name = "Calibri"
    r2_sub.font.size = Pt(9.5)
    r2_sub.font.color.rgb = muted_gray

    p_exp2_sub = doc.add_paragraph()
    p_exp2_sub.paragraph_format.space_before = Pt(0)
    p_exp2_sub.paragraph_format.space_after = Pt(2)
    r2_t = p_exp2_sub.add_run("Research Trainee – Human Molecular Genetics Laboratory")
    r2_t.bold = True
    r2_t.italic = True
    r2_t.font.name = "Calibri"
    r2_t.font.size = Pt(10)
    r2_t.font.color.rgb = primary_color
    r2_d = p_exp2_sub.add_run("  |  Oct 2021 – Apr 2022")
    r2_d.font.name = "Calibri"
    r2_d.font.size = Pt(9.5)
    r2_d.font.color.rgb = muted_gray

    add_bullet("Genetics & Molecular Workflows:", "Investigated molecular and statistical genetic approaches, genotyping workflows, and candidate gene association studies in neurodevelopmental disorders.")
    add_bullet("Experimental Execution:", "Performed primer design, PCR optimization, agarose gel electrophoresis, RNA/DNA isolation, cell culture, and Sanger sequencing analyses.")
    add_bullet("Computational Scripting & Publication:", "Implemented bash and Python scripts for NGS data analysis and sequence alignment; synthesized findings into a review manuscript analyzing de novo genomic variations published in a peer-reviewed journal.")

    # 4. Applied Biopharma & Computational Projects
    add_section_header("Applied Biopharma & Computational Projects")
    add_bullet("Computational Antibody Design & Developability (IBAB Hackathon | Dec 2025):", "Redesigned Keytruda (anti-PD-1) using CDR engineering and germline-based framework optimization. Modeled 3D tertiary structures via AlphaFold2 (ColabFold) and applied rational in silico mutagenesis to optimize binding affinity, conformational stability, and biophysical developability.")
    add_bullet("Oral Microbiome Biomarker Discovery for Early Cancer Detection (Jan 2026):", "Investigated 16S rRNA sequencing datasets using QIIME2 (DADA2) for quality control, denoising, and ASV generation; performed alpha/beta diversity and taxonomic profiling (SILVA); developed machine learning classification models (logistic regression, decision trees) in Python/R to identify non-invasive diagnostic biomarkers.")

    # 5. Education & Credentials
    add_section_header("Education & Credentials")
    
    def add_edu(degree, institute, dates, grade):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(3)
        p.paragraph_format.space_after = Pt(1)
        r_deg = p.add_run(degree)
        r_deg.bold = True
        r_deg.font.name = "Calibri"
        r_deg.font.size = Pt(10)
        r_deg.font.color.rgb = charcoal
        
        p_sub = doc.add_paragraph()
        p_sub.paragraph_format.space_before = Pt(0)
        p_sub.paragraph_format.space_after = Pt(2)
        r_inst = p_sub.add_run(institute + "  (" + dates + ")")
        r_inst.italic = True
        r_inst.font.name = "Calibri"
        r_inst.font.size = Pt(9.5)
        r_inst.font.color.rgb = dark_gray
        if grade:
            r_g = p_sub.add_run("  |  " + grade)
            r_g.bold = True
            r_g.font.name = "Calibri"
            r_g.font.size = Pt(9.5)
            r_g.font.color.rgb = primary_color

    add_edu("Post Graduate Diploma in Bioinformatics & Genomics (Data Science)", "Bversity", "Jul 2025 – Present", "Advanced Specialization")
    add_edu("Master of Science (M.Sc.) in Zoology (Honours)", "North-Eastern Hill University (NEHU), Shillong", "2018 – 2020", "CGPA: 5.5 / 6.0 scale")
    add_edu("Bachelor of Science (B.Sc.) in Zoology (Honours)", "St. Edmund’s College, NEHU, Shillong", "2015 – 2018", "81.5% — First Rank Holder (Prof. D.C. Dhar Memorial Award)")

    # 6. Publications & Honors
    add_section_header("Publications, Honors & Certifications")
    add_bullet("Peer-Reviewed Publication:", "Deb, S. (2025). The mosaic genome: De novo variations driving neurodevelopment in autism spectrum disorder, intellectual disability, and epilepsy. IP Indian Journal of Neurosciences, 11(3), 133–143. doi:10.18231/j.ijn.11927.1759983172")
    add_bullet("Syngene SPOT Award (Feb 2023):", "Conferred by Dept. of Discovery Biology for exemplary troubleshooting and on-time delivery of critical client biotherapeutic batches.")
    add_bullet("Academic Honors & Awards:", "Prof. D.C. Dhar Memorial Award (First Rank Holder in B.Sc. Zoology Honours); Certificate of Academic Excellence (3rd Rank in NEHU University Merit List); Rajendra Kumar Sunheri Devi Charitable Endowment Book Grant (Top 2% of batch).")
    add_bullet("Specialized Certifications:", "Statistical Analysis & Interpretation using SPSS (GISS, 2021); Molecular & Biochemistry Techniques Training (IIT Kharagpur Springfest, 2020); Neuroscience Reconstructed: Genetics & Development (EPFL - edX).")

    doc.save(output_path)
    print(f"Successfully generated DOCX at {output_path}")


class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        canvas.Canvas.__init__(self, *args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_number(num_pages)
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def draw_page_number(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8.5)
        self.setFillColor(colors.HexColor("#6B7280"))
        page_text = f"Sudakshina Deb  |  General Industry Resume  |  Page {self._pageNumber} of {page_count}"
        self.drawCentredString(letter[0] / 2.0, 24, page_text)
        self.restoreState()


def generate_pdf(output_path):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=letter,
        leftMargin=38,
        rightMargin=38,
        topMargin=32,
        bottomMargin=36
    )

    styles = getSampleStyleSheet()

    # Custom typography styles
    navy = colors.HexColor("#1E3A8A")
    dark_gray = colors.HexColor("#1F2937")
    body_gray = colors.HexColor("#374151")
    muted = colors.HexColor("#4B5563")

    style_name = ParagraphStyle(
        'Name',
        fontName='Helvetica-Bold',
        fontSize=18,
        leading=22,
        alignment=TA_CENTER,
        textColor=navy,
        spaceAfter=2
    )

    style_sub = ParagraphStyle(
        'SubTitle',
        fontName='Helvetica-Bold',
        fontSize=10.5,
        leading=14,
        alignment=TA_CENTER,
        textColor=dark_gray,
        spaceAfter=3
    )

    style_contact = ParagraphStyle(
        'Contact',
        fontName='Helvetica',
        fontSize=8.5,
        leading=11,
        alignment=TA_CENTER,
        textColor=muted,
        spaceAfter=6
    )

    style_sec = ParagraphStyle(
        'SectionHeading',
        fontName='Helvetica-Bold',
        fontSize=10,
        leading=13,
        textColor=navy,
        spaceBefore=7,
        spaceAfter=2
    )

    style_body = ParagraphStyle(
        'Body',
        fontName='Helvetica',
        fontSize=8.8,
        leading=11.8,
        alignment=TA_JUSTIFY,
        textColor=body_gray,
        spaceAfter=3
    )

    style_bullet = ParagraphStyle(
        'Bullet',
        fontName='Helvetica',
        fontSize=8.6,
        leading=11.6,
        textColor=body_gray,
        leftIndent=12,
        firstLineIndent=-12,
        spaceAfter=2.5
    )

    style_job_title = ParagraphStyle(
        'JobTitle',
        fontName='Helvetica-Bold',
        fontSize=9.5,
        leading=12,
        textColor=dark_gray,
        spaceBefore=4,
        spaceAfter=1
    )

    style_job_sub = ParagraphStyle(
        'JobSub',
        fontName='Helvetica-Oblique',
        fontSize=9,
        leading=12,
        textColor=navy,
        spaceAfter=2
    )

    story = []

    # Header
    story.append(Paragraph("SUDAKSHINA DEB", style_name))
    story.append(Paragraph("Senior Scientist — Discovery Biology & Downstream Protein Sciences", style_sub))
    story.append(Paragraph("Bengaluru, India  |  +91-7005314758  |  sudakshinadeb97@gmail.com  |  linkedin.com/in/sudakshina-deb", style_contact))

    def add_sec_banner(title):
        story.append(Paragraph(title.upper(), style_sec))
        story.append(HRFlowable(width="100%", thickness=1.0, color=navy, spaceBefore=1, spaceAfter=4))

    # 1. Profile
    add_sec_banner("Professional Profile")
    story.append(Paragraph(
        "Results-driven <b>Senior Scientist with ~4 years of biopharmaceutical industry experience</b> in Discovery Biology and "
        "Downstream Protein Sciences at <b>Syngene International Ltd.</b> Proven track record leading end-to-end purification of "
        "complex biologics—including monoclonal antibodies (mAbs), bispecific antibodies (bsAbs), and His-tagged recombinant "
        "proteins—utilizing ÄKTA chromatography systems (Protein A/G, Ni-NTA, IEX, HIC, SEC) and Tangential Flow Filtration (TFF). "
        "Highly proficient in analytical release testing and quality characterization (SEC-HPLC, SDS-PAGE, Western blot, LC-MS/MS, "
        "UV-Vis, Endosafe kinetic LAL endotoxin assays) under strict GLP/ALCOA++ data integrity compliance. Seamlessly integrates "
        "wet-lab bioprocess rigor with computational genomics and bioinformatics workflows (Python, R, QIIME2, AlphaFold2). "
        "Conferred the <b>Syngene SPOT Award (Feb 2023)</b> for rapid troubleshooting and high-recovery protein delivery for global biopharma clients.",
        style_body
    ))

    # 2. Competencies
    add_sec_banner("Core Technical Competencies")
    story.append(Paragraph("• <b>Downstream Bioprocess & Chromatography:</b> ÄKTA Pure, ÄKTA Avant, UNICORN software; Affinity (Protein A/G, Ni-NTA His-tag), Ion Exchange (IEX/CEX/AEX), Hydrophobic Interaction (HIC), Size Exclusion (SEC/GFC); Desalting, Buffer Exchange, Batch Binding, Dialysis, Ultrafiltration/Diafiltration (UF/DF), Tangential Flow Filtration (TFF, Pellicon cassettes).", style_bullet))
    story.append(Paragraph("• <b>Bioanalytical Characterization & Quality Release:</b> SEC-HPLC (monomer purity & aggregate profiling), SDS-PAGE (reducing/non-reducing), Western Blotting, LC-MS/MS, UV-Vis Spectrophotometry, Endosafe PTS/MCS (kinetic LAL endotoxin testing/removal), Flow Cytometry, Protein Impurity Characterization.", style_bullet))
    story.append(Paragraph("• <b>Molecular Biology & Laboratory Operations:</b> Recombinant protein expression, PCR, Primer Design, Sanger Sequencing, Gene Expression Profiling, Aseptic Mammalian Cell Culture, Media Prep, Passaging, In Vivo Animal Handling (rodent surgical procedures, model organisms).", style_bullet))
    story.append(Paragraph("• <b>Computational Biology & Data Science:</b> Python (Pandas, Biopython), R (tidyverse), Linux/Bash shell scripting, NGS Genomic Data Analysis, QIIME2 (DADA2 pipeline), AlphaFold2 (ColabFold), In Silico Antibody CDR Engineering, Biological Databases (SILVA, NCBI BLAST, STRING, ExPASy).", style_bullet))
    story.append(Paragraph("• <b>Quality & Regulatory Governance:</b> ALCOA++ Data Integrity Standards, Standard Operating Procedures (SOPs), Batch Manufacturing Records (BMRs), GLP/GMP Laboratory Compliance, Cross-Functional Client Milestone Delivery.", style_bullet))

    # 3. Experience
    add_sec_banner("Professional Industry Experience")
    
    # Syngene
    story.append(Paragraph("SYNGENE INTERNATIONAL LIMITED  <font color='#6B7280' size=8.5>|  Bengaluru, India</font>", style_job_title))
    story.append(Paragraph("Senior Scientist – Discovery Biology  <font color='#6B7280' size=8.5>|  May 2022 – Present</font>", style_job_sub))
    story.append(Paragraph("• <b>Biotherapeutic Downstream Purification:</b> Lead multi-step preparative chromatography purification workflows for 40+ recombinant therapeutic projects, including mono- and bi-specific antibodies and His-tagged proteins using ÄKTA Pure and ÄKTA Avant systems.", style_bullet))
    story.append(Paragraph("• <b>Chromatography Method Development:</b> Developed, scaled, and standardized chromatographic purification protocols across Protein A/G, Ni-NTA, CEX, AEX, HIC, and SEC, consistently achieving >95% monomer purity and quantitative recovery yields.", style_bullet))
    story.append(Paragraph("• <b>Bioprocess & TFF Filtration:</b> Formulated and optimized Tangential Flow Filtration (TFF) and ultrafiltration/diafiltration (UF/DF) operational parameters, improving cycle turnaround by 25% while safeguarding product stability.", style_bullet))
    story.append(Paragraph("• <b>Analytical Release Testing:</b> Conducted routine release testing and quality characterization via SEC-HPLC aggregate profiling, reducing and non-reducing SDS-PAGE, Western blot validation, UV-Vis, and Endosafe kinetic LAL endotoxin quantification.", style_bullet))
    story.append(Paragraph("• <b>Cross-Functional Client Delivery:</b> Collaborated with cross-functional Discovery Biology and analytical teams to optimize protocols, troubleshoot challenging aggregation barriers, and ensure timely delivery of complex proteins for global biopharma clients.", style_bullet))
    story.append(Paragraph("• <b>Syngene SPOT Award (Feb 2023):</b> Recognized with departmental SPOT Award for producing and delivering highly challenging proteins within compressed timelines, earning direct client commendation.", style_bullet))

    # RGCB
    story.append(Paragraph("RAJIV GANDHI CENTRE FOR BIOTECHNOLOGY (RGCB)  <font color='#6B7280' size=8.5>|  Trivandrum, India</font>", style_job_title))
    story.append(Paragraph("Research Trainee – Human Molecular Genetics Laboratory  <font color='#6B7280' size=8.5>|  Oct 2021 – Apr 2022</font>", style_job_sub))
    story.append(Paragraph("• <b>Genetics & Molecular Workflows:</b> Investigated molecular and statistical genetic approaches, genotyping workflows, and candidate gene association studies in neurodevelopmental disorders.", style_bullet))
    story.append(Paragraph("• <b>Experimental Execution:</b> Performed primer design, PCR optimization, agarose gel electrophoresis, RNA/DNA isolation, cell culture, and Sanger sequencing analyses.", style_bullet))
    story.append(Paragraph("• <b>Computational Scripting & Publication:</b> Implemented bash and Python scripts for NGS data analysis and sequence alignment; synthesized findings into a review manuscript analyzing de novo genomic variations published in a peer-reviewed journal.", style_bullet))

    # 4. Applied Projects
    add_sec_banner("Applied Biopharma & Computational Projects")
    story.append(Paragraph("• <b>Computational Antibody Design & Developability (IBAB Hackathon | Dec 2025):</b> Redesigned Keytruda (anti-PD-1) using CDR engineering and germline-based framework optimization. Modeled 3D tertiary structures via AlphaFold2 (ColabFold) and applied rational in silico mutagenesis to optimize binding affinity, conformational stability, and biophysical developability.", style_bullet))
    story.append(Paragraph("• <b>Oral Microbiome Biomarker Discovery for Early Cancer Detection (Jan 2026):</b> Investigated 16S rRNA sequencing datasets using QIIME2 (DADA2) for quality control, denoising, and ASV generation; performed alpha/beta diversity and taxonomic profiling (SILVA); developed machine learning classification models (logistic regression, decision trees) in Python/R to identify non-invasive diagnostic biomarkers.", style_bullet))

    # 5. Education
    add_sec_banner("Education & Credentials")
    story.append(Paragraph("<b>Post Graduate Diploma in Bioinformatics & Genomics (Data Science)</b>  |  <i>Bversity</i> (Jul 2025 – Present)  —  <font color='#1E3A8A'><b>Advanced Specialization</b></font>", style_bullet))
    story.append(Paragraph("<b>Master of Science (M.Sc.) in Zoology (Honours)</b>  |  <i>North-Eastern Hill University (NEHU), Shillong</i> (2018 – 2020)  —  <font color='#1E3A8A'><b>CGPA: 5.5 / 6.0 scale</b></font>", style_bullet))
    story.append(Paragraph("<b>Bachelor of Science (B.Sc.) in Zoology (Honours)</b>  |  <i>St. Edmund’s College, NEHU, Shillong</i> (2015 – 2018)  —  <font color='#1E3A8A'><b>81.5% — First Rank Holder (Prof. D.C. Dhar Memorial Award)</b></font>", style_bullet))

    # 6. Publications & Certifications
    add_sec_banner("Publications, Honors & Certifications")
    story.append(Paragraph("• <b>Peer-Reviewed Publication:</b> Deb, S. (2025). The mosaic genome: De novo variations driving neurodevelopment in autism spectrum disorder, intellectual disability, and epilepsy. <i>IP Indian Journal of Neurosciences</i>, 11(3), 133–143. doi:10.18231/j.ijn.11927.1759983172", style_bullet))
    story.append(Paragraph("• <b>Syngene SPOT Award (Feb 2023):</b> Conferred by Dept. of Discovery Biology for exemplary technical troubleshooting and delivering challenging biotherapeutic targets under tight client timelines.", style_bullet))
    story.append(Paragraph("• <b>Academic Honors & Awards:</b> Prof. D.C. Dhar Memorial Award (First Rank Holder in B.Sc. Zoology); Certificate of Academic Excellence (3rd Rank in NEHU University Merit List); Rajendra Kumar Sunheri Devi Charitable Endowment Book Grant (Top 2% of batch).", style_bullet))
    story.append(Paragraph("• <b>Specialized Certifications:</b> Statistical Analysis using SPSS (GISS, 2021); Molecular & Biochemistry Techniques Training (IIT Kharagpur Springfest, 2020); Neuroscience: Genetics & Development (EPFL - edX).", style_bullet))

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"Successfully generated PDF at {output_path}")

if __name__ == "__main__":
    base_dir = os.path.dirname(os.path.abspath(__file__))
    docx_file = os.path.join(base_dir, "Sudakshina_Deb_General_Resume.docx")
    pdf_file = os.path.join(base_dir, "Sudakshina_Deb_General_Resume.pdf")
    generate_docx(docx_file)
    generate_pdf(pdf_file)
